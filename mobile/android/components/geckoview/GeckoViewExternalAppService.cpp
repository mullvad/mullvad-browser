/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "GeckoViewExternalAppService.h"

#include "mozilla/dom/BrowsingContext.h"
#include "mozilla/dom/CanonicalBrowsingContext.h"
#include "mozilla/dom/WindowGlobalParent.h"
#include "nsIChannel.h"
#include "nsIMIMEService.h"
#include "nsMimeTypes.h"
#include "nsServiceManagerUtils.h"

#include "mozilla/widget/EventDispatcher.h"
#include "mozilla/widget/nsWindow.h"
#include "GeckoViewStreamListener.h"

#include "JavaBuiltins.h"

class StreamListener final : public mozilla::GeckoViewStreamListener {
 public:
  StreamListener(nsWindow* aWindow, const nsAString& aFileName)
      : GeckoViewStreamListener(), mWindow(aWindow), mFileName(aFileName) {
    MOZ_ASSERT(aWindow);
  }

  void AmendWebResponse(
      mozilla::java::WebResponse::Builder::Param aBuilder) override {
    if (mFileName.IsEmpty()) {
      return;
    }
    nsAutoString disposition(u"attachment; filename=\""_ns);
    disposition.Append(mFileName);
    disposition.Append(u'"');
    aBuilder->Header(mozilla::jni::StringParam(u"content-disposition"_ns),
                     mozilla::jni::StringParam(disposition));
  }

  void SendWebResponse(mozilla::java::WebResponse::Param aResponse) override {
    mWindow->PassExternalResponse(aResponse);
  }

  void CompleteWithError(nsresult aStatus, nsIChannel* aChannel) override {
    // Currently we don't do anything about errors here
  }

  virtual ~StreamListener() {}

 private:
  RefPtr<nsWindow> mWindow;
  // Filename validated by the MIME service, or empty if none was found.
  nsString mFileName;
};

mozilla::StaticRefPtr<GeckoViewExternalAppService>
    GeckoViewExternalAppService::sService;

/* static */
already_AddRefed<GeckoViewExternalAppService>
GeckoViewExternalAppService::GetSingleton() {
  if (!sService) {
    sService = new GeckoViewExternalAppService();
  }
  RefPtr<GeckoViewExternalAppService> service = sService;
  return service.forget();
}

GeckoViewExternalAppService::GeckoViewExternalAppService() {}

NS_IMPL_ISUPPORTS(GeckoViewExternalAppService, nsIExternalHelperAppService);

NS_IMETHODIMP GeckoViewExternalAppService::DoContent(
    const nsACString& aMimeContentType, nsIChannel* aChannel,
    nsIInterfaceRequestor* aContentContext, bool aForceSave,
    nsIInterfaceRequestor* aWindowContext,
    nsIStreamListener** aStreamListener) {
  return NS_ERROR_FAILURE;
}

NS_IMETHODIMP GeckoViewExternalAppService::CreateListener(
    const nsACString& aMimeContentType, nsIChannel* aChannel,
    mozilla::dom::BrowsingContext* aContentContext, bool aForceSave,
    nsIInterfaceRequestor* aWindowContext,
    nsIStreamListener** aStreamListener) {
  using namespace mozilla;
  using namespace mozilla::dom;
  MOZ_ASSERT(XRE_IsParentProcess());
  NS_ENSURE_ARG_POINTER(aChannel);

  nsCOMPtr<nsIWidget> widget =
      aContentContext->Canonical()->GetParentProcessWidgetContaining();
  if (!widget) {
    return NS_ERROR_ABORT;
  }

  RefPtr<nsWindow> window = nsWindow::From(widget);
  if (NS_WARN_IF(!window) || NS_WARN_IF(window->Destroyed())) {
    return NS_ERROR_ABORT;
  }

  nsAutoString fileName;
  nsCOMPtr<nsIMIMEService> mimeService = do_GetService("@mozilla.org/mime;1");
  if (mimeService) {
    uint32_t flags = nsIMIMEService::VALIDATE_ALLOW_EMPTY;
    if (aMimeContentType.Equals(APPLICATION_GUESS_FROM_EXT,
                                nsCaseInsensitiveCStringComparator)) {
      flags |= nsIMIMEService::VALIDATE_GUESS_FROM_EXTENSION;
    }
    mimeService->GetValidFileName(aChannel, aMimeContentType, nullptr, flags,
                                  fileName);
  }

  RefPtr<StreamListener> listener = new StreamListener(window, fileName);

  nsresult rv;
  rv = aChannel->SetNotificationCallbacks(listener);
  NS_ENSURE_SUCCESS(rv, rv);

  listener.forget(aStreamListener);
  return NS_OK;
}

NS_IMETHODIMP GeckoViewExternalAppService::ApplyDecodingForExtension(
    const nsACString& aExtension, const nsACString& aEncodingType,
    bool* aApplyDecoding) {
  // This currently doesn't matter, because we never read the stream.
  *aApplyDecoding = true;
  return NS_OK;
}

NS_IMETHODIMP GeckoViewExternalAppService::GetPreferredDownloadsDirectory(
    nsIFile** _retval) {
  MOZ_ASSERT(false);
  return nsresult::NS_ERROR_NOT_IMPLEMENTED;
}
