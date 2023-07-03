/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsCopySupport.h"

#include "imgIContainer.h"
#include "imgIRequest.h"
#include "mozilla/ScopeExit.h"
#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/DataTransfer.h"
#include "mozilla/dom/Document.h"
#include "nsComponentManagerUtils.h"
#include "nsFocusManager.h"
#include "nsFrameSelection.h"
#include "nsGkAtoms.h"
#include "nsGlobalWindowInner.h"
#include "nsHTMLDocument.h"
#include "nsIClipboard.h"
#include "nsIContent.h"
#include "nsIDocShell.h"
#include "nsIDocumentEncoder.h"
#include "nsIDocumentViewerEdit.h"
#include "nsIFormControl.h"
#include "nsIFrame.h"
#include "nsISelectionController.h"
#include "nsISupports.h"
#include "nsISupportsPrimitives.h"
#include "nsPIDOMWindow.h"
#include "nsRange.h"
#include "nsServiceManagerUtils.h"
#include "nsURLHelper.h"
#include "nsWidgetsCID.h"
#include "nsXPCOM.h"

// image copy stuff
#include "nsContentUtils.h"
#include "nsIImageLoadingContent.h"
#include "nsIInterfaceRequestorUtils.h"

#ifdef XP_WIN
#  include "mozilla/StaticPrefs_clipboard.h"
#  include "nsCExternalHandlerService.h"
#  include "nsEscape.h"
#  include "nsIMIMEInfo.h"
#  include "nsIMIMEService.h"
#  include "nsIURIMutator.h"
#  include "nsIURL.h"
#  include "nsReadableUtils.h"
#  include "nsXULAppAPI.h"
#endif

#include "mozilla/ContentEvents.h"
#include "mozilla/EventDispatcher.h"
#include "mozilla/IntegerRange.h"
#include "mozilla/Preferences.h"
#include "mozilla/PresShell.h"
#include "mozilla/TextEditor.h"
#include "mozilla/dom/Element.h"
#include "mozilla/dom/HTMLInputElement.h"
#include "mozilla/dom/Selection.h"

using namespace mozilla;
using namespace mozilla::dom;

static NS_DEFINE_CID(kCClipboardCID, NS_CLIPBOARD_CID);
static NS_DEFINE_CID(kCTransferableCID, NS_TRANSFERABLE_CID);
static NS_DEFINE_CID(kHTMLConverterCID, NS_HTMLFORMATCONVERTER_CID);

// copy string data onto the transferable
static nsresult AppendString(nsITransferable* aTransferable,
                             const nsAString& aString, const char* aFlavor);

// copy HTML node data
static nsresult AppendDOMNode(nsITransferable* aTransferable,
                              nsINode* aDOMNode);

#ifdef XP_WIN
// copy image as file promise onto the transferable
static nsresult AppendImagePromise(nsITransferable* aTransferable,
                                   imgIRequest* aImgRequest,
                                   nsINode* aImageNode);
#endif

static nsresult EncodeForTextPlain(nsIDocumentEncoder& aEncoder,
                                   Document& aDocument, Selection* aSelection,
                                   uint32_t aAdditionalEncoderFlags,
                                   bool& aCanBeEncodedAsTextHTML,
                                   nsAString& aSerializationResult) {
  // We assign text/html as the MIME type first, but in fact nsHTMLCopyEncoder
  // force the use of text/plain depending where the selection is (e.g., a
  // selection inside an <input> or <textarea> element). See
  // nsHTMLCopyEncoder::SetSelection. We can then use this behavior to detect
  // whether the selection can be encoded as text/html by checking the MIME type
  // after nsHTMLCopyEncoder::SetSelection.
  nsAutoString mimeType;
  mimeType.AssignLiteral(kHTMLMime);

  // Do the first and potentially trial encoding as preformatted and raw.
  uint32_t flags = aAdditionalEncoderFlags |
                   nsIDocumentEncoder::OutputPreformatted |
                   nsIDocumentEncoder::OutputRaw |
                   nsIDocumentEncoder::OutputForPlainTextClipboardCopy |
                   nsIDocumentEncoder::OutputPersistNBSP;

  nsresult rv = aEncoder.Init(&aDocument, mimeType, flags);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = aEncoder.SetSelection(aSelection);
  NS_ENSURE_SUCCESS(rv, rv);

  // SetSelection set the mime type to text/plain if the selection is inside a
  // text widget.
  rv = aEncoder.GetMimeType(mimeType);
  NS_ENSURE_SUCCESS(rv, rv);

  // XXX: For XHTML documents, we would like to use pretty-printing encoding for
  // text/plain, just as we do for HTML documents. This is achieved by
  // relying on the current nsHTMLCopyEncoder design, where the MIME
  // type is not updated to text/plain immediately in
  // nsHTMLCopyEncoder::SetSelection(), but only latter when
  // nsHTMLCopyEncoder::EncodeToString() is called. As a result, we still see a
  // text/html MIME type here for XHTML documents.
  if (mimeType.EqualsLiteral(kTextMime)) {
    // nsHTMLCopyEncoder force to use text/plain.
    nsAutoString buf;
    rv = aEncoder.EncodeToString(buf);
    if (NS_SUCCEEDED(rv)) {
      // Nothing to do. buf contains the final, preformatted, raw text/plain.
      aSerializationResult.Assign(buf);
    }
    return rv;
  }

  MOZ_ASSERT(mimeType.EqualsLiteral(kHTMLMime));
  // XXX: We currently only try to encode as text/html for HTML documents.
  // See bug 857915.
  if (aDocument.IsHTMLDocument()) {
    aCanBeEncodedAsTextHTML = true;
  }

  // Do the text/plain encoding, but this time use pretty printing.
  flags = nsIDocumentEncoder::OutputSelectionOnly |
          nsIDocumentEncoder::OutputForPlainTextClipboardCopy |
          nsIDocumentEncoder::OutputAbsoluteLinks |
          nsIDocumentEncoder::SkipInvisibleContent |
          nsIDocumentEncoder::OutputDropInvisibleBreak |
          (aAdditionalEncoderFlags &
           (nsIDocumentEncoder::OutputNoScriptContent |
            nsIDocumentEncoder::OutputRubyAnnotation |
            nsIDocumentEncoder::AllowCrossShadowBoundary));

  mimeType.AssignLiteral(kTextMime);
  rv = aEncoder.Init(&aDocument, mimeType, flags);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = aEncoder.SetSelection(aSelection);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = aEncoder.EncodeToString(aSerializationResult);
  return rv;
}

static nsresult EncodeAsTextHTMLWithContext(
    nsIDocumentEncoder& aEncoder, Document& aDocument, Selection* aSelection,
    uint32_t aEncoderFlags, nsAutoString& aTextHTMLEncodingResult,
    nsAutoString& aHTMLParentsBufResult, nsAutoString& aHTMLInfoBufResult) {
  nsAutoString mimeType;
  mimeType.AssignLiteral(kHTMLMime);
  nsresult rv = aEncoder.Init(&aDocument, mimeType, aEncoderFlags);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = aEncoder.SetSelection(aSelection);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = aEncoder.EncodeToStringWithContext(
      aHTMLParentsBufResult, aHTMLInfoBufResult, aTextHTMLEncodingResult);
  NS_ENSURE_SUCCESS(rv, rv);
  return rv;
}

struct EncodedDocumentWithContext {
  // Whether the document can be encoded as text/html.
  bool mCanBeEncodedAsTextHTML = false;

  // The serialized document when encoding the document with `text/plain`.
  nsAutoString mSerializationForTextPlain;

  // When `mCanBeEncodedAsTextHTML` is true, this is the serialized document
  // using `text/html`.
  nsAutoString mSerializationForTextHTML;

  // When `mCanBeEncodedAsTextHTML` is true, this contains the serialized
  // ancestor elements.
  nsAutoString mHTMLContextBuffer;

  // When `mCanBeEncodedAsTextHTML` is true, this contains numbers
  // identifying where in the context the serialization came from.
  nsAutoString mHTMLInfoBuffer;
};

/**
 * @param aSelection Can be nullptr.
 * @param aAdditionalEncoderFlags nsIDocumentEncoder flags.
 */
static nsresult EncodeDocumentWithContext(
    Document& aDocument, Selection* aSelection,
    uint32_t aAdditionalEncoderFlags,
    EncodedDocumentWithContext& aEncodedDocumentWithContext) {
  nsCOMPtr<nsIDocumentEncoder> docEncoder = do_createHTMLCopyEncoder();

  bool canBeEncodedAsTextHTML{false};
  nsAutoString serializationForTextPlain;
  nsresult rv = EncodeForTextPlain(
      *docEncoder, aDocument, aSelection, aAdditionalEncoderFlags,
      canBeEncodedAsTextHTML, serializationForTextPlain);
  NS_ENSURE_SUCCESS(rv, rv);

  nsAutoString serializationForTextHTML;
  nsAutoString htmlContextBuffer;
  nsAutoString htmlInfoBuffer;
  if (canBeEncodedAsTextHTML) {
    // Redo the encoding, but this time use the passed-in flags.
    // Don't allow wrapping of CJK strings.
    rv = EncodeAsTextHTMLWithContext(
        *docEncoder, aDocument, aSelection,
        aAdditionalEncoderFlags |
            nsIDocumentEncoder::OutputDisallowLineBreaking,
        serializationForTextHTML, htmlContextBuffer, htmlInfoBuffer);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  aEncodedDocumentWithContext = {
      canBeEncodedAsTextHTML, std::move(serializationForTextPlain),
      std::move(serializationForTextHTML), std::move(htmlContextBuffer),
      std::move(htmlInfoBuffer)};

  return rv;
}

static nsresult CreateTransferable(
    const EncodedDocumentWithContext& aEncodedDocumentWithContext,
    Document& aDocument, nsCOMPtr<nsITransferable>& aTransferable) {
  nsresult rv = NS_OK;

  aTransferable = do_CreateInstance(kCTransferableCID);
  NS_ENSURE_TRUE(aTransferable, NS_ERROR_NULL_POINTER);

  aTransferable->Init(aDocument.GetLoadContext());
  aTransferable->SetDataPrincipal(aDocument.NodePrincipal());
  if (aEncodedDocumentWithContext.mCanBeEncodedAsTextHTML) {
    // XXX: Now we provide the text/plain directly, do we still need to always
    // set a HTML converter? Or perhaps we could set the converter only when the
    // text/plain is not available.
    // Set up a format converter so that clipboard flavor queries work.
    // This converter isn't really used for conversions.
    nsCOMPtr<nsIFormatConverter> htmlConverter =
        do_CreateInstance(kHTMLConverterCID);
    aTransferable->SetConverter(htmlConverter);

    if (!aEncodedDocumentWithContext.mSerializationForTextHTML.IsEmpty()) {
      // Add the html DataFlavor to the transferable
      rv = AppendString(aTransferable,
                        aEncodedDocumentWithContext.mSerializationForTextHTML,
                        kHTMLMime);
      NS_ENSURE_SUCCESS(rv, rv);
    }

    // Add the htmlcontext DataFlavor to the transferable. Even if the context
    // buffer is empty, this flavor should be attached to the transferable.
    rv = AppendString(aTransferable,
                      aEncodedDocumentWithContext.mHTMLContextBuffer,
                      kHTMLContext);
    NS_ENSURE_SUCCESS(rv, rv);

    if (!aEncodedDocumentWithContext.mHTMLInfoBuffer.IsEmpty()) {
      // Add the htmlinfo DataFlavor to the transferable
      rv = AppendString(aTransferable,
                        aEncodedDocumentWithContext.mHTMLInfoBuffer, kHTMLInfo);
      NS_ENSURE_SUCCESS(rv, rv);
    }

    if (!aEncodedDocumentWithContext.mSerializationForTextPlain.IsEmpty()) {
      // Add the plain text DataFlavor to the transferable
      // If we didn't have this, then nsDataObj::GetData matches
      // text/plain against the kURLMime flavour which is not desirable
      // (eg. when pasting into Notepad)
      rv = AppendString(aTransferable,
                        aEncodedDocumentWithContext.mSerializationForTextPlain,
                        kTextMime);
      NS_ENSURE_SUCCESS(rv, rv);
    }
  } else {
    if (!aEncodedDocumentWithContext.mSerializationForTextPlain.IsEmpty()) {
      // Add the unicode DataFlavor to the transferable
      rv = AppendString(aTransferable,
                        aEncodedDocumentWithContext.mSerializationForTextPlain,
                        kTextMime);
      NS_ENSURE_SUCCESS(rv, rv);
    }
  }

#if !defined(BASE_BROWSER_VERSION)
  // Append the source of the item being dragged.
  return nsCopySupport::AppendSourceURL(
      *aTransferable, nsCopySupport::GetDocumentSourceURL(aDocument));
#else
  return NS_OK;
#endif
}

nsString nsCopySupport::GetDocumentSourceURL(
    mozilla::dom::Document& aDocument) {
  // This a trusted document, so we don't need to attach any source.
  if (nsContentUtils::IsChromeDoc(&aDocument) ||
      nsContentUtils::IsAddonDoc(&aDocument) ||
      aDocument.ChromeRulesEnabled()) {
    return EmptyString();
  }

  // In private browsing mode only return about:internet like
  // WinUtils::MaybeWriteFileZoneIdSync.
  if (aDocument.IsInPrivateBrowsing()) {
    return u"about:internet"_ns;
  }

  nsAutoCString origin;
  MOZ_ALWAYS_SUCCEEDS(aDocument.NodePrincipal()->GetOriginNoSuffix(origin));

  return NS_ConvertUTF8toUTF16(origin);
}

nsresult nsCopySupport::AppendSourceURL(nsITransferable& aTransferable,
                                        const nsAString& aSourceURL) {
  if (aSourceURL.IsEmpty()) {
    return NS_OK;
  }

  // Don't use kURLMime, as it will cause an unnecessary
  // UniformResourceLocator to be added which confuses some apps, such as
  // Outlook 2000 (bug 315370). Don't use kURLDataMime, as it will cause a
  // bogus 'url ' flavor to show up on the Mac clipboard, confusing other
  // apps, such as Terminal (bug 336012).
  //
  // This MIME type will be used by Microsoft Defender to detect TerminalFix
  // style attacks and prompt the user before pasting into their console.
  return AppendString(&aTransferable, aSourceURL, kURLPrivateMime);
}

static nsresult PutToClipboard(
    const EncodedDocumentWithContext& aEncodedDocumentWithContext,
    nsIClipboard::ClipboardType aClipboardID, Document& aDocument) {
  nsresult rv;
  nsCOMPtr<nsIClipboard> clipboard = do_GetService(kCClipboardCID, &rv);
  NS_ENSURE_SUCCESS(rv, rv);
  NS_ENSURE_TRUE(clipboard, NS_ERROR_NULL_POINTER);

  nsCOMPtr<nsITransferable> transferable;
  rv = CreateTransferable(aEncodedDocumentWithContext, aDocument, transferable);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = clipboard->SetData(transferable, nullptr, aClipboardID,
                          aDocument.GetWindowContext());
  NS_ENSURE_SUCCESS(rv, rv);

  return rv;
}

nsresult nsCopySupport::EncodeDocumentWithContextAndPutToClipboard(
    Selection* aSel, Document* aDoc, nsIClipboard::ClipboardType aClipboardID,
    bool aWithRubyAnnotation, UpdateClipboard aUpdateClipboard /* = Yes */) {
  NS_ENSURE_TRUE(aDoc, NS_ERROR_NULL_POINTER);

  uint32_t additionalFlags = nsIDocumentEncoder::SkipInvisibleContent |
                             nsIDocumentEncoder::AllowCrossShadowBoundary;

  if (aWithRubyAnnotation) {
    additionalFlags |= nsIDocumentEncoder::OutputRubyAnnotation;
  }

  EncodedDocumentWithContext encodedDocumentWithContext;
  nsresult rv = EncodeDocumentWithContext(*aDoc, aSel, additionalFlags,
                                          encodedDocumentWithContext);
  NS_ENSURE_SUCCESS(rv, rv);

  if (aUpdateClipboard == UpdateClipboard::Yes) {
    rv = PutToClipboard(encodedDocumentWithContext, aClipboardID, *aDoc);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  return rv;
}

nsresult nsCopySupport::ClearSelectionCache() {
  nsresult rv;
  nsCOMPtr<nsIClipboard> clipboard = do_GetService(kCClipboardCID, &rv);
  clipboard->EmptyClipboard(nsIClipboard::kSelectionCache);
  return rv;
}

/**
 * @param aAdditionalEncoderFlags flags of `nsIDocumentEncoder`.
 * @param aTransferable Needs to be not `nullptr`.
 */
static nsresult EncodeDocumentWithContextAndCreateTransferable(
    Document& aDocument, Selection* aSelection,
    uint32_t aAdditionalEncoderFlags, nsITransferable** aTransferable) {
  NS_ENSURE_TRUE(aTransferable, NS_ERROR_NULL_POINTER);

  // Clear the output parameter for the transferable.
  *aTransferable = nullptr;

  EncodedDocumentWithContext encodedDocumentWithContext;
  nsresult rv =
      EncodeDocumentWithContext(aDocument, aSelection, aAdditionalEncoderFlags,
                                encodedDocumentWithContext);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsITransferable> transferable;
  rv = CreateTransferable(encodedDocumentWithContext, aDocument, transferable);
  NS_ENSURE_SUCCESS(rv, rv);

  transferable.swap(*aTransferable);
  return rv;
}

nsresult nsCopySupport::GetTransferableForSelection(
    Selection* aSel, Document* aDoc, nsITransferable** aTransferable) {
  NS_ENSURE_TRUE(aDoc, NS_ERROR_NULL_POINTER);
  NS_ENSURE_TRUE(aTransferable, NS_ERROR_NULL_POINTER);

  const uint32_t additionalFlags = nsIDocumentEncoder::SkipInvisibleContent |
                                   nsIDocumentEncoder::AllowCrossShadowBoundary;

  return EncodeDocumentWithContextAndCreateTransferable(
      *aDoc, aSel, additionalFlags, aTransferable);
}

nsresult nsCopySupport::GetTransferableForNode(
    nsINode* aNode, Document* aDoc, nsITransferable** aTransferable) {
  NS_ENSURE_TRUE(aNode, NS_ERROR_NULL_POINTER);
  NS_ENSURE_TRUE(aDoc, NS_ERROR_NULL_POINTER);
  NS_ENSURE_TRUE(aTransferable, NS_ERROR_NULL_POINTER);

  // Make a temporary selection with aNode in a single range.
  // XXX We should try to get rid of the Selection object here.
  // XXX bug 1245883
  RefPtr<Selection> selection = new Selection(SelectionType::eNormal, nullptr);
  RefPtr<nsRange> range = nsRange::Create(aNode);
  ErrorResult result;
  range->SelectNode(*aNode, result);
  if (NS_WARN_IF(result.Failed())) {
    return result.StealNSResult();
  }
  selection->AddRangeAndSelectFramesAndNotifyListenersInternal(*range, aDoc,
                                                               result);
  if (NS_WARN_IF(result.Failed())) {
    return result.StealNSResult();
  }
  // It's not the primary selection - so don't skip invisible content.
  uint32_t additionalFlags = 0;
  return EncodeDocumentWithContextAndCreateTransferable(
      *aDoc, selection, additionalFlags, aTransferable);
}

nsresult nsCopySupport::GetContents(const nsACString& aMimeType,
                                    uint32_t aFlags, Selection* aSel,
                                    Document* aDoc, nsAString& outdata) {
  nsCOMPtr<nsIDocumentEncoder> docEncoder =
      do_createDocumentEncoder(PromiseFlatCString(aMimeType).get());
  NS_ENSURE_TRUE(docEncoder, NS_ERROR_FAILURE);

  uint32_t flags = aFlags | nsIDocumentEncoder::SkipInvisibleContent;

  if (aMimeType.EqualsLiteral("text/plain"))
    flags |= nsIDocumentEncoder::OutputPreformatted;

  NS_ConvertASCIItoUTF16 unicodeMimeType(aMimeType);

  nsresult rv = docEncoder->Init(aDoc, unicodeMimeType, flags);
  if (NS_FAILED(rv)) return rv;

  if (aSel) {
    rv = docEncoder->SetSelection(aSel);
    if (NS_FAILED(rv)) return rv;
  }

  // encode the selection
  return docEncoder->EncodeToString(outdata);
}

nsresult nsCopySupport::ImageCopy(
    nsIImageLoadingContent* aImageElement, nsILoadContext* aLoadContext,
    int32_t aCopyFlags, mozilla::dom::WindowContext* aSettingWindowContext) {
  nsresult rv;

  nsCOMPtr<nsINode> imageNode = do_QueryInterface(aImageElement, &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  // create a transferable for putting data on the Clipboard
  nsCOMPtr<nsITransferable> trans(do_CreateInstance(kCTransferableCID, &rv));
  NS_ENSURE_SUCCESS(rv, rv);
  trans->Init(aLoadContext);
  trans->SetDataPrincipal(imageNode->NodePrincipal());

  if (aCopyFlags & nsIDocumentViewerEdit::COPY_IMAGE_TEXT) {
    // get the location from the element
    nsCOMPtr<nsIURI> uri;
    rv = aImageElement->GetCurrentURI(getter_AddRefs(uri));
    NS_ENSURE_SUCCESS(rv, rv);
    NS_ENSURE_TRUE(uri, NS_ERROR_FAILURE);

    nsAutoCString location;
    rv = uri->GetSpec(location);
    NS_ENSURE_SUCCESS(rv, rv);

    // append the string to the transferable
    rv = AppendString(trans, NS_ConvertUTF8toUTF16(location), kTextMime);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  if (aCopyFlags & nsIDocumentViewerEdit::COPY_IMAGE_HTML) {
    // append HTML data to the transferable
    nsCOMPtr<nsINode> node(do_QueryInterface(aImageElement, &rv));
    NS_ENSURE_SUCCESS(rv, rv);

    rv = AppendDOMNode(trans, node);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  if (aCopyFlags & nsIDocumentViewerEdit::COPY_IMAGE_DATA) {
    // get the image data and its request from the element
    nsCOMPtr<imgIRequest> imgRequest;
    nsCOMPtr<imgIContainer> image = nsContentUtils::GetImageFromContent(
        aImageElement, getter_AddRefs(imgRequest));
    NS_ENSURE_TRUE(image, NS_ERROR_FAILURE);

    if (imgRequest) {
      // Remember the referrer used for this image request.
      nsCOMPtr<nsIReferrerInfo> referrerInfo;
      imgRequest->GetReferrerInfo(getter_AddRefs(referrerInfo));
      trans->SetReferrerInfo(referrerInfo);
    }

#ifdef XP_WIN
    if (StaticPrefs::clipboard_imageAsFile_enabled()) {
      rv = AppendImagePromise(trans, imgRequest, imageNode);
      NS_ENSURE_SUCCESS(rv, rv);
    }
#endif

    // copy the image data onto the transferable
    rv = trans->SetTransferData(kNativeImageMime, image);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  // get clipboard
  nsCOMPtr<nsIClipboard> clipboard(do_GetService(kCClipboardCID, &rv));
  NS_ENSURE_SUCCESS(rv, rv);

  // check whether the system supports the selection clipboard or not.
  if (clipboard->IsClipboardTypeSupported(nsIClipboard::kSelectionClipboard)) {
    // put the transferable on the clipboard
    rv = clipboard->SetData(trans, nullptr, nsIClipboard::kSelectionClipboard,
                            aSettingWindowContext);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  return clipboard->SetData(trans, nullptr, nsIClipboard::kGlobalClipboard,
                            aSettingWindowContext);
}

static nsresult AppendString(nsITransferable* aTransferable,
                             const nsAString& aString, const char* aFlavor) {
  nsresult rv;

  nsCOMPtr<nsISupportsString> data(
      do_CreateInstance(NS_SUPPORTS_STRING_CONTRACTID, &rv));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = data->SetData(aString);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = aTransferable->AddDataFlavor(aFlavor);
  NS_ENSURE_SUCCESS(rv, rv);

  return aTransferable->SetTransferData(aFlavor, data);
}

static nsresult AppendDOMNode(nsITransferable* aTransferable,
                              nsINode* aDOMNode) {
  nsresult rv;

  // serializer
  nsCOMPtr<nsIDocumentEncoder> docEncoder = do_createHTMLCopyEncoder();

  // get document for the encoder
  nsCOMPtr<Document> document = aDOMNode->OwnerDoc();

  // Note that XHTML is not counted as HTML here, because we can't copy it
  // properly (all the copy code for non-plaintext assumes using HTML
  // serializers and parsers is OK, and those mess up XHTML).
  NS_ENSURE_TRUE(document->IsHTMLDocument(), NS_OK);

  // init encoder with document and node
  rv = docEncoder->Init(document, NS_LITERAL_STRING_FROM_CSTRING(kHTMLMime),
                        nsIDocumentEncoder::OutputAbsoluteLinks |
                            nsIDocumentEncoder::OutputEncodeBasicEntities);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = docEncoder->SetNode(aDOMNode);
  NS_ENSURE_SUCCESS(rv, rv);

  // serialize to string
  nsAutoString html, context, info;
  rv = docEncoder->EncodeToStringWithContext(context, info, html);
  NS_ENSURE_SUCCESS(rv, rv);

  // copy them to the transferable
  if (!html.IsEmpty()) {
    rv = AppendString(aTransferable, html, kHTMLMime);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  if (!info.IsEmpty()) {
    rv = AppendString(aTransferable, info, kHTMLInfo);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  // add a special flavor, even if we don't have html context data
  return AppendString(aTransferable, context, kHTMLContext);
}

#ifdef XP_WIN
static nsresult AppendImagePromise(nsITransferable* aTransferable,
                                   imgIRequest* aImgRequest,
                                   nsINode* aImageNode) {
  nsresult rv;

  NS_ENSURE_TRUE(aImgRequest && aImageNode, NS_OK);

  bool isMultipart;
  rv = aImgRequest->GetMultipart(&isMultipart);
  NS_ENSURE_SUCCESS(rv, rv);
  if (isMultipart) {
    return NS_OK;
  }

  nsCOMPtr<nsIMIMEService> mimeService = do_GetService("@mozilla.org/mime;1");
  if (NS_WARN_IF(!mimeService)) {
    return NS_ERROR_FAILURE;
  }

  nsCOMPtr<nsIURI> imgUri;
  rv = aImgRequest->GetFinalURI(getter_AddRefs(imgUri));
  NS_ENSURE_SUCCESS(rv, rv);

  nsAutoCString spec;
  rv = imgUri->GetSpec(spec);
  NS_ENSURE_SUCCESS(rv, rv);

  // pass out the image source string
  nsString imageSourceString;
  CopyUTF8toUTF16(spec, imageSourceString);

  nsCString mimeType;
  rv = aImgRequest->GetMimeType(getter_Copies(mimeType));
  NS_ENSURE_SUCCESS(rv, rv);

  nsAutoCString fileName;
  rv = aImgRequest->GetFileName(fileName);
  NS_ENSURE_SUCCESS(rv, rv);

  nsAutoString validFileName = NS_ConvertUTF8toUTF16(fileName);
  mimeService->ValidateFileNameForSaving(
      validFileName, mimeType, nsIMIMEService::VALIDATE_DEFAULT, validFileName);

  rv = AppendString(aTransferable, imageSourceString, kFilePromiseURLMime);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = AppendString(aTransferable, validFileName, kFilePromiseDestFilename);
  NS_ENSURE_SUCCESS(rv, rv);

  aTransferable->SetCookieJarSettings(
      aImageNode->OwnerDoc()->CookieJarSettings());
  aTransferable->SetContentPolicyType(nsIContentPolicy::TYPE_INTERNAL_IMAGE);

  // add the dataless file promise flavor
  return aTransferable->AddDataFlavor(kFilePromiseMime);
}
#endif  // XP_WIN

already_AddRefed<Selection> nsCopySupport::GetSelectionForCopy(
    Document* aDocument) {
  PresShell* presShell = aDocument->GetPresShell();
  if (NS_WARN_IF(!presShell)) {
    return nullptr;
  }

  RefPtr<nsFrameSelection> frameSel = presShell->GetLastFocusedFrameSelection();
  if (NS_WARN_IF(!frameSel)) {
    return nullptr;
  }

  RefPtr<Selection> sel = &frameSel->NormalSelection();
  return sel.forget();
}

bool nsCopySupport::CanCopy(Document* aDocument) {
  if (!aDocument) {
    return false;
  }

  RefPtr<Selection> sel = GetSelectionForCopy(aDocument);
  return sel && !sel->IsCollapsed();
}

static bool IsInsideRuby(nsINode* aNode) {
  for (; aNode; aNode = aNode->GetParent()) {
    if (aNode->IsHTMLElement(nsGkAtoms::ruby)) {
      return true;
    }
  }
  return false;
}

static bool IsSelectionInsideRuby(Selection* aSelection) {
  uint32_t rangeCount = aSelection->RangeCount();
  for (auto i : IntegerRange(rangeCount)) {
    MOZ_ASSERT(aSelection->RangeCount() == rangeCount);
    const nsRange* range = aSelection->GetRangeAt(i);
    if (!IsInsideRuby(range->GetClosestCommonInclusiveAncestor())) {
      return false;
    }
  }
  return true;
}

static Element* GetElementOrNearestFlattenedTreeParentElement(nsINode* aNode) {
  if (!aNode->IsContent()) {
    return nullptr;
  }
  for (nsIContent* content = aNode->AsContent(); content;
       content = content->GetFlattenedTreeParent()) {
    if (content->IsElement()) {
      return content->AsElement();
    }
  }
  return nullptr;
}

/**
 * This class is used while processing clipboard paste event.
 */
class MOZ_RAII AutoHandlingPasteEvent final {
 public:
  explicit AutoHandlingPasteEvent(
      nsGlobalWindowInner* aWindow, DataTransfer* aDataTransfer,
      const EventMessage& aEventMessage,
      const mozilla::Maybe<nsIClipboard::ClipboardType> aClipboardType) {
    MOZ_ASSERT(aDataTransfer);
    if (aWindow && aEventMessage == ePaste &&
        aClipboardType == Some(nsIClipboard::kGlobalClipboard)) {
      aWindow->SetCurrentPasteDataTransfer(aDataTransfer);
      mInnerWindow = aWindow;
    }
  }

  ~AutoHandlingPasteEvent() {
    if (mInnerWindow) {
      mInnerWindow->SetCurrentPasteDataTransfer(nullptr);
    }
  }

 private:
  RefPtr<nsGlobalWindowInner> mInnerWindow;
};

bool nsCopySupport::FireClipboardEvent(
    EventMessage aEventMessage,
    mozilla::Maybe<nsIClipboard::ClipboardType> aClipboardType,
    PresShell* aPresShell, Selection* aSelection, DataTransfer* aDataTransfer,
    bool* aActionTaken) {
  if (aActionTaken) {
    *aActionTaken = false;
  }

  EventMessage originalEventMessage = aEventMessage;
  if (originalEventMessage == ePasteNoFormatting) {
    originalEventMessage = ePaste;
  }

  NS_ASSERTION(originalEventMessage == eCut || originalEventMessage == eCopy ||
                   originalEventMessage == ePaste,
               "Invalid clipboard event type");

  MOZ_ASSERT_IF(originalEventMessage != ePaste, aClipboardType.isSome());

  RefPtr<PresShell> presShell = aPresShell;
  if (!presShell) {
    return false;
  }

  nsCOMPtr<Document> doc = presShell->GetDocument();
  if (!doc) return false;

  nsCOMPtr<nsPIDOMWindowOuter> piWindow = doc->GetWindow();
  if (!piWindow) return false;

  // Event target of clipboard events should be an element node which
  // contains selection start container.
  RefPtr<Element> targetElement;

  // If a selection was not supplied, try to find it.
  RefPtr<Selection> sel = aSelection;
  if (!sel) {
    sel = GetSelectionForCopy(doc);
  }

  // Retrieve the event target node from the start of the selection.
  if (sel) {
    const nsRange* range = sel->GetRangeAt(0);
    if (range) {
      targetElement = GetElementOrNearestFlattenedTreeParentElement(
          range->GetStartContainer());
    }
  }

  // If there is no selection ranges, use the <body> or <frameset> element.
  if (!targetElement) {
    targetElement = doc->GetBody();
    if (!targetElement) {
      return false;
    }
  }

  // It seems to be unsafe to fire an event handler during reflow (bug 393696)
  if (!nsContentUtils::IsSafeToRunScript()) {
    nsContentUtils::WarnScriptWasIgnored(doc);
    return false;
  }

  BrowsingContext* bc = piWindow->GetBrowsingContext();
  const bool chromeShell = bc && bc->IsChrome();

  // next, fire the cut, copy or paste event
  bool doDefault = true;
  RefPtr<DataTransfer> clipboardData;
  if (chromeShell || StaticPrefs::dom_event_clipboardevents_enabled()) {
    MOZ_ASSERT_IF(aDataTransfer,
                  aDataTransfer->GetParentObject() == doc->GetScopeObject());
    MOZ_ASSERT_IF(aDataTransfer, (aDataTransfer->GetEventMessage() == ePaste) &&
                                     (aEventMessage == ePaste ||
                                      aEventMessage == ePasteNoFormatting));
    MOZ_ASSERT_IF(aDataTransfer,
                  aDataTransfer->ClipboardType() == aClipboardType);
    clipboardData = aDataTransfer
                        ? RefPtr<DataTransfer>(aDataTransfer)
                        : MakeRefPtr<DataTransfer>(
                              doc->GetScopeObject(), aEventMessage,
                              originalEventMessage == ePaste, aClipboardType);

    nsEventStatus status = nsEventStatus_eIgnore;
    InternalClipboardEvent evt(true, originalEventMessage);
    evt.mClipboardData = clipboardData;

    {
      AutoHandlingPasteEvent autoHandlingPasteEvent(
          nsGlobalWindowInner::Cast(doc->GetInnerWindow()), clipboardData,
          aEventMessage, aClipboardType);

      RefPtr<nsPresContext> presContext = presShell->GetPresContext();
      EventDispatcher::Dispatch(targetElement, presContext, &evt, nullptr,
                                &status);
    }

    // If the event was cancelled, don't do the clipboard operation
    doDefault = (status != nsEventStatus_eConsumeNoDefault);
  }

  // When this function exits, the event dispatch is over. We want to disconnect
  // our DataTransfer, which means setting its mode to `Protected` and clearing
  // all stored data, before we return.
  auto clearAfter = MakeScopeExit([&] {
    if (clipboardData && !aDataTransfer) {
      clipboardData->Disconnect();

      // NOTE: Disconnect may not actually clear the DataTransfer if the
      // dom.events.dataTransfer.protected.enabled pref is not on, so we make
      // sure we clear here, as not clearing could provide the DataTransfer
      // access to information from the system clipboard at an arbitrary point
      // in the future.
      if (originalEventMessage == ePaste) {
        clipboardData->ClearAll();
      }
    }
  });

  // No need to do anything special during a paste. Either an event listener
  // took care of it and cancelled the event, or the caller will handle it.
  // Return true to indicate that the event wasn't cancelled.
  if (originalEventMessage == ePaste) {
    if (aActionTaken) {
      *aActionTaken = true;
    }
    return doDefault;
  }

  // Update the presentation in case the event handler modified the selection,
  // see bug 602231.
  presShell->FlushPendingNotifications(FlushType::Frames);
  if (presShell->IsDestroying()) {
    return false;
  }

  // if the event was not cancelled, do the default copy. If the event was
  // cancelled, use the data added to the data transfer and copy that instead.
  uint32_t count = 0;
  if (doDefault) {
    // find the focused node
    nsIContent* sourceContent = targetElement.get();
    if (targetElement->IsInNativeAnonymousSubtree()) {
      sourceContent = targetElement->FindFirstNonChromeOnlyAccessContent();
    }

    // If it's <input type="password"> and there is no unmasked range or
    // there is unmasked range but it's collapsed or it'll be masked
    // automatically, the selected password shouldn't be copied into the
    // clipboard.
    if (RefPtr<HTMLInputElement> inputElement =
            HTMLInputElement::FromNodeOrNull(sourceContent)) {
      if (TextEditor* textEditor = inputElement->GetTextEditor()) {
        if (textEditor->IsPasswordEditor() &&
            !textEditor->IsCopyToClipboardAllowed()) {
          return false;
        }
      }
    }

    // when cutting non-editable content, do nothing
    // XXX this is probably the wrong editable flag to check
    if (originalEventMessage != eCut || targetElement->IsEditable()) {
      // get the data from the selection if any
      if (sel->AreNormalAndCrossShadowBoundaryRangesCollapsed()) {
        if (aActionTaken) {
          *aActionTaken = true;
        }
        return false;
      }
      // XXX Code which decides whether we should copy text with ruby
      // annotation is currenct depending on whether each range of the
      // selection is inside a same ruby container. But we really should
      // expose the full functionality in browser. See bug 1130891.
      bool withRubyAnnotation = IsSelectionInsideRuby(sel);
      nsresult rv = EncodeDocumentWithContextAndPutToClipboard(
          sel, doc, *aClipboardType, withRubyAnnotation);
      if (NS_FAILED(rv)) {
        return false;
      }
    } else {
      return false;
    }
  } else if (clipboardData) {
    // check to see if any data was put on the data transfer.
    count = clipboardData->MozItemCount();
    if (count) {
      nsCOMPtr<nsIClipboard> clipboard(
          do_GetService("@mozilla.org/widget/clipboard;1"));
      NS_ENSURE_TRUE(clipboard, false);

      nsCOMPtr<nsITransferable> transferable =
          clipboardData->GetTransferable(0, doc->GetLoadContext());

      NS_ENSURE_TRUE(transferable, false);

      if (NS_FAILED(
              AppendSourceURL(*transferable, GetDocumentSourceURL(*doc)))) {
        return false;
      }

      // put the transferable on the clipboard
      WindowContext* settingWindowContext = nullptr;
      if (aPresShell && aPresShell->GetDocument()) {
        settingWindowContext = aPresShell->GetDocument()->GetWindowContext();
      }
      nsresult rv = clipboard->SetData(transferable, nullptr, *aClipboardType,
                                       settingWindowContext);
      if (NS_FAILED(rv)) {
        return false;
      }
    }
  }

  // Now that we have copied, update the clipboard commands. This should have
  // the effect of updating the enabled state of the paste menu item.
  if (doDefault || count) {
    piWindow->UpdateCommands(u"clipboard"_ns);
    if (aPresShell && aPresShell->GetDocument()) {
      // Record that a copy to the clipboard was triggered by JS code
      aPresShell->GetDocument()->SetClipboardCopyTriggered();
    }
  }

  if (aActionTaken) {
    *aActionTaken = true;
  }
  return doDefault;
}
