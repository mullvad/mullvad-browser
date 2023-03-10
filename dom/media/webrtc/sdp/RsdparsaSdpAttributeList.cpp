/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "sdp/RsdparsaSdpAttributeList.h"

#include <limits>
#include <ostream>
#include <string>

#include "SdpAttribute.h"
#include "mozilla/Assertions.h"
#include "nsCRT.h"
#include "nsTArray.h"
#include "sdp/RsdparsaSdpGlue.h"
#include "sdp/RsdparsaSdpInc.h"

namespace mozilla {

namespace ffi = mozilla::sdp::ffi;

MOZ_GLIBCXX_CONSTINIT const std::string RsdparsaSdpAttributeList::kEmptyString;

bool RsdparsaSdpAttributeList::HasAttribute(const AttributeType type,
                                            const bool sessionFallback) const {
  return !!GetAttribute(type, sessionFallback);
}

const SdpAttribute* RsdparsaSdpAttributeList::GetAttribute(
    const AttributeType type, const bool sessionFallback) const {
  const SdpAttribute* value = mAttributes[static_cast<size_t>(type)].get();
  // Only do fallback when the attribute can appear at both the media and
  // session level
  if (!value && !AtSessionLevel() && sessionFallback &&
      SdpAttribute::IsAllowedAtSessionLevel(type) &&
      SdpAttribute::IsAllowedAtMediaLevel(type)) {
    return mSessionAttributes->GetAttribute(type, false);
  }
  return value;
}

void RsdparsaSdpAttributeList::RemoveAttribute(const AttributeType type) {
  mAttributes[static_cast<size_t>(type)] = nullptr;
}

void RsdparsaSdpAttributeList::Clear() {
  for (size_t i = 0; i < kNumAttributeTypes; ++i) {
    RemoveAttribute(static_cast<AttributeType>(i));
  }
}

uint32_t RsdparsaSdpAttributeList::Count() const {
  uint32_t count = 0;
  for (auto& mAttribute : mAttributes) {
    if (mAttribute) {
      count++;
    }
  }
  return count;
}

void RsdparsaSdpAttributeList::SetAttribute(UniquePtr<SdpAttribute>&& attr) {
  if (!IsAllowedHere(attr->GetType())) {
    MOZ_ASSERT(false, "This type of attribute is not allowed here");
    return;
  }
  mAttributes[attr->GetType()] = std::move(attr);
}

const std::vector<std::string>& RsdparsaSdpAttributeList::GetCandidate() const {
  if (!HasAttribute(SdpAttribute::kCandidateAttribute)) {
    MOZ_CRASH();
  }

  return static_cast<const SdpMultiStringAttribute*>(
             GetAttribute(SdpAttribute::kCandidateAttribute))
      ->mValues;
}

const SdpConnectionAttribute& RsdparsaSdpAttributeList::GetConnection() const {
  if (!HasAttribute(SdpAttribute::kConnectionAttribute)) {
    MOZ_CRASH();
  }

  return *static_cast<const SdpConnectionAttribute*>(
      GetAttribute(SdpAttribute::kConnectionAttribute));
}

SdpDirectionAttribute::Direction RsdparsaSdpAttributeList::GetDirection()
    const {
  if (!HasAttribute(SdpAttribute::kDirectionAttribute)) {
    MOZ_CRASH();
  }

  const SdpAttribute* attr = GetAttribute(SdpAttribute::kDirectionAttribute);
  return static_cast<const SdpDirectionAttribute*>(attr)->mValue;
}

const SdpDtlsMessageAttribute& RsdparsaSdpAttributeList::GetDtlsMessage()
    const {
  if (!HasAttribute(SdpAttribute::kDtlsMessageAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kDtlsMessageAttribute);
  return *static_cast<const SdpDtlsMessageAttribute*>(attr);
}

const SdpExtmapAttributeList& RsdparsaSdpAttributeList::GetExtmap() const {
  if (!HasAttribute(SdpAttribute::kExtmapAttribute)) {
    MOZ_CRASH();
  }

  return *static_cast<const SdpExtmapAttributeList*>(
      GetAttribute(SdpAttribute::kExtmapAttribute));
}

const SdpFingerprintAttributeList& RsdparsaSdpAttributeList::GetFingerprint()
    const {
  if (!HasAttribute(SdpAttribute::kFingerprintAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kFingerprintAttribute);
  return *static_cast<const SdpFingerprintAttributeList*>(attr);
}

const SdpFmtpAttributeList& RsdparsaSdpAttributeList::GetFmtp() const {
  if (!HasAttribute(SdpAttribute::kFmtpAttribute)) {
    MOZ_CRASH();
  }

  return *static_cast<const SdpFmtpAttributeList*>(
      GetAttribute(SdpAttribute::kFmtpAttribute));
}

const SdpGroupAttributeList& RsdparsaSdpAttributeList::GetGroup() const {
  if (!HasAttribute(SdpAttribute::kGroupAttribute)) {
    MOZ_CRASH();
  }

  return *static_cast<const SdpGroupAttributeList*>(
      GetAttribute(SdpAttribute::kGroupAttribute));
}

const SdpOptionsAttribute& RsdparsaSdpAttributeList::GetIceOptions() const {
  if (!HasAttribute(SdpAttribute::kIceOptionsAttribute)) {
    MOZ_CRASH();
  }

  const SdpAttribute* attr = GetAttribute(SdpAttribute::kIceOptionsAttribute);
  return *static_cast<const SdpOptionsAttribute*>(attr);
}

const std::string& RsdparsaSdpAttributeList::GetIcePwd() const {
  if (!HasAttribute(SdpAttribute::kIcePwdAttribute)) {
    return kEmptyString;
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kIcePwdAttribute);
  return static_cast<const SdpStringAttribute*>(attr)->mValue;
}

const std::string& RsdparsaSdpAttributeList::GetIceUfrag() const {
  if (!HasAttribute(SdpAttribute::kIceUfragAttribute)) {
    return kEmptyString;
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kIceUfragAttribute);
  return static_cast<const SdpStringAttribute*>(attr)->mValue;
}

const std::string& RsdparsaSdpAttributeList::GetIdentity() const {
  if (!HasAttribute(SdpAttribute::kIdentityAttribute)) {
    return kEmptyString;
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kIdentityAttribute);
  return static_cast<const SdpStringAttribute*>(attr)->mValue;
}

const SdpImageattrAttributeList& RsdparsaSdpAttributeList::GetImageattr()
    const {
  if (!HasAttribute(SdpAttribute::kImageattrAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kImageattrAttribute);
  return *static_cast<const SdpImageattrAttributeList*>(attr);
}

const SdpSimulcastAttribute& RsdparsaSdpAttributeList::GetSimulcast() const {
  if (!HasAttribute(SdpAttribute::kSimulcastAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kSimulcastAttribute);
  return *static_cast<const SdpSimulcastAttribute*>(attr);
}

const std::string& RsdparsaSdpAttributeList::GetLabel() const {
  if (!HasAttribute(SdpAttribute::kLabelAttribute)) {
    return kEmptyString;
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kLabelAttribute);
  return static_cast<const SdpStringAttribute*>(attr)->mValue;
}

uint32_t RsdparsaSdpAttributeList::GetMaxptime() const {
  if (!HasAttribute(SdpAttribute::kMaxptimeAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kMaxptimeAttribute);
  return static_cast<const SdpNumberAttribute*>(attr)->mValue;
}

const std::string& RsdparsaSdpAttributeList::GetMid() const {
  if (!HasAttribute(SdpAttribute::kMidAttribute)) {
    return kEmptyString;
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kMidAttribute);
  return static_cast<const SdpStringAttribute*>(attr)->mValue;
}

const SdpMsidAttributeList& RsdparsaSdpAttributeList::GetMsid() const {
  if (!HasAttribute(SdpAttribute::kMsidAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kMsidAttribute);
  return *static_cast<const SdpMsidAttributeList*>(attr);
}

const SdpMsidSemanticAttributeList& RsdparsaSdpAttributeList::GetMsidSemantic()
    const {
  if (!HasAttribute(SdpAttribute::kMsidSemanticAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kMsidSemanticAttribute);
  return *static_cast<const SdpMsidSemanticAttributeList*>(attr);
}

const SdpRidAttributeList& RsdparsaSdpAttributeList::GetRid() const {
  if (!HasAttribute(SdpAttribute::kRidAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kRidAttribute);
  return *static_cast<const SdpRidAttributeList*>(attr);
}

uint32_t RsdparsaSdpAttributeList::GetPtime() const {
  if (!HasAttribute(SdpAttribute::kPtimeAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kPtimeAttribute);
  return static_cast<const SdpNumberAttribute*>(attr)->mValue;
}

const SdpRtcpAttribute& RsdparsaSdpAttributeList::GetRtcp() const {
  if (!HasAttribute(SdpAttribute::kRtcpAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kRtcpAttribute);
  return *static_cast<const SdpRtcpAttribute*>(attr);
}

const SdpRtcpFbAttributeList& RsdparsaSdpAttributeList::GetRtcpFb() const {
  if (!HasAttribute(SdpAttribute::kRtcpFbAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kRtcpFbAttribute);
  return *static_cast<const SdpRtcpFbAttributeList*>(attr);
}

const SdpRemoteCandidatesAttribute&
RsdparsaSdpAttributeList::GetRemoteCandidates() const {
  MOZ_CRASH("Not yet implemented");
}

const SdpRtpmapAttributeList& RsdparsaSdpAttributeList::GetRtpmap() const {
  if (!HasAttribute(SdpAttribute::kRtpmapAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kRtpmapAttribute);
  return *static_cast<const SdpRtpmapAttributeList*>(attr);
}

const SdpSctpmapAttributeList& RsdparsaSdpAttributeList::GetSctpmap() const {
  if (!HasAttribute(SdpAttribute::kSctpmapAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kSctpmapAttribute);
  return *static_cast<const SdpSctpmapAttributeList*>(attr);
}

uint32_t RsdparsaSdpAttributeList::GetSctpPort() const {
  if (!HasAttribute(SdpAttribute::kSctpPortAttribute)) {
    MOZ_CRASH();
  }

  const SdpAttribute* attr = GetAttribute(SdpAttribute::kSctpPortAttribute);
  return static_cast<const SdpNumberAttribute*>(attr)->mValue;
}

uint32_t RsdparsaSdpAttributeList::GetMaxMessageSize() const {
  if (!HasAttribute(SdpAttribute::kMaxMessageSizeAttribute)) {
    MOZ_CRASH();
  }

  const SdpAttribute* attr =
      GetAttribute(SdpAttribute::kMaxMessageSizeAttribute);
  return static_cast<const SdpNumberAttribute*>(attr)->mValue;
}

const SdpSetupAttribute& RsdparsaSdpAttributeList::GetSetup() const {
  if (!HasAttribute(SdpAttribute::kSetupAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kSetupAttribute);
  return *static_cast<const SdpSetupAttribute*>(attr);
}

const SdpSsrcAttributeList& RsdparsaSdpAttributeList::GetSsrc() const {
  if (!HasAttribute(SdpAttribute::kSsrcAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kSsrcAttribute);
  return *static_cast<const SdpSsrcAttributeList*>(attr);
}

const SdpSsrcGroupAttributeList& RsdparsaSdpAttributeList::GetSsrcGroup()
    const {
  if (!HasAttribute(SdpAttribute::kSsrcGroupAttribute)) {
    MOZ_CRASH();
  }
  const SdpAttribute* attr = GetAttribute(SdpAttribute::kSsrcGroupAttribute);
  return *static_cast<const SdpSsrcGroupAttributeList*>(attr);
}

void RsdparsaSdpAttributeList::LoadAttribute(RustAttributeList* attributeList,
                                             const AttributeType type) {
  if (!mAttributes[type]) {
    switch (type) {
      case SdpAttribute::kIceUfragAttribute:
        LoadIceUfrag(attributeList);
        return;
      case SdpAttribute::kIcePwdAttribute:
        LoadIcePwd(attributeList);
        return;
      case SdpAttribute::kIceOptionsAttribute:
        LoadIceOptions(attributeList);
        return;
      case SdpAttribute::kDtlsMessageAttribute:
        LoadDtlsMessage(attributeList);
        return;
      case SdpAttribute::kFingerprintAttribute:
        LoadFingerprint(attributeList);
        return;
      case SdpAttribute::kIdentityAttribute:
        LoadIdentity(attributeList);
        return;
      case SdpAttribute::kSetupAttribute:
        LoadSetup(attributeList);
        return;
      case SdpAttribute::kSsrcAttribute:
        LoadSsrc(attributeList);
        return;
      case SdpAttribute::kRtpmapAttribute:
        LoadRtpmap(attributeList);
        return;
      case SdpAttribute::kFmtpAttribute:
        LoadFmtp(attributeList);
        return;
      case SdpAttribute::kPtimeAttribute:
        LoadPtime(attributeList);
        return;
      case SdpAttribute::kIceLiteAttribute:
      case SdpAttribute::kRtcpMuxAttribute:
      case SdpAttribute::kRtcpRsizeAttribute:
      case SdpAttribute::kBundleOnlyAttribute:
      case SdpAttribute::kEndOfCandidatesAttribute:
      case SdpAttribute::kExtmapAllowMixedAttribute:
        LoadFlags(attributeList);
        return;
      case SdpAttribute::kMaxMessageSizeAttribute:
        LoadMaxMessageSize(attributeList);
        return;
      case SdpAttribute::kMidAttribute:
        LoadMid(attributeList);
        return;
      case SdpAttribute::kMsidAttribute:
        LoadMsid(attributeList);
        return;
      case SdpAttribute::kMsidSemanticAttribute:
        LoadMsidSemantics(attributeList);
        return;
      case SdpAttribute::kGroupAttribute:
        LoadGroup(attributeList);
        return;
      case SdpAttribute::kRtcpAttribute:
        LoadRtcp(attributeList);
        return;
      case SdpAttribute::kRtcpFbAttribute:
        LoadRtcpFb(attributeList);
        return;
      case SdpAttribute::kImageattrAttribute:
        LoadImageattr(attributeList);
        return;
      case SdpAttribute::kSctpmapAttribute:
        LoadSctpmaps(attributeList);
        return;
      case SdpAttribute::kDirectionAttribute:
        LoadDirection(attributeList);
        return;
      case SdpAttribute::kRemoteCandidatesAttribute:
        LoadRemoteCandidates(attributeList);
        return;
      case SdpAttribute::kRidAttribute:
        LoadRids(attributeList);
        return;
      case SdpAttribute::kSctpPortAttribute:
        LoadSctpPort(attributeList);
        return;
      case SdpAttribute::kExtmapAttribute:
        LoadExtmap(attributeList);
        return;
      case SdpAttribute::kSimulcastAttribute:
        LoadSimulcast(attributeList);
        return;
      case SdpAttribute::kMaxptimeAttribute:
        LoadMaxPtime(attributeList);
        return;
      case SdpAttribute::kCandidateAttribute:
        LoadCandidate(attributeList);
        return;
      case SdpAttribute::kSsrcGroupAttribute:
        LoadSsrcGroup(attributeList);
        return;
      case SdpAttribute::kConnectionAttribute:
      case SdpAttribute::kIceMismatchAttribute:
      case SdpAttribute::kLabelAttribute:
        // These attributes are unused
        return;
    }
  }
}

void RsdparsaSdpAttributeList::LoadAll(RustAttributeList* attributeList) {
  for (int i = SdpAttribute::kFirstAttribute; i <= SdpAttribute::kLastAttribute;
       i++) {
    LoadAttribute(attributeList, static_cast<SdpAttribute::AttributeType>(i));
  }
}

void RsdparsaSdpAttributeList::LoadIceUfrag(RustAttributeList* attributeList) {
  ffi::StringView ufragStr;
  nsresult nr = sdp_get_iceufrag(attributeList, &ufragStr);
  if (NS_SUCCEEDED(nr)) {
    SetAttribute(MakeUnique<SdpStringAttribute>(
        SdpAttribute::kIceUfragAttribute,
        std::string(convertStringView(ufragStr))));
  }
}

void RsdparsaSdpAttributeList::LoadIcePwd(RustAttributeList* attributeList) {
  ffi::StringView pwdStr;
  nsresult nr = sdp_get_icepwd(attributeList, &pwdStr);
  if (NS_SUCCEEDED(nr)) {
    SetAttribute(
        MakeUnique<SdpStringAttribute>(SdpAttribute::kIcePwdAttribute,
                                       std::string(convertStringView(pwdStr))));
  }
}

void RsdparsaSdpAttributeList::LoadIdentity(RustAttributeList* attributeList) {
  ffi::StringView identityStr;
  nsresult nr = sdp_get_identity(attributeList, &identityStr);
  if (NS_SUCCEEDED(nr)) {
    SetAttribute(MakeUnique<SdpStringAttribute>(
        SdpAttribute::kIdentityAttribute,
        std::string(convertStringView(identityStr))));
  }
}

void RsdparsaSdpAttributeList::LoadIceOptions(
    RustAttributeList* attributeList) {
  AutoTArray<ffi::StringView, 8> optionsArray;
  nsresult nr = sdp_get_iceoptions(attributeList, &optionsArray);
  if (NS_SUCCEEDED(nr)) {
    auto optionsAttr =
        MakeUnique<SdpOptionsAttribute>(SdpAttribute::kIceOptionsAttribute);
    for (const auto& view : optionsArray) {
      optionsAttr->PushEntry(std::string(convertStringView(view)));
    }
    SetAttribute(std::move(optionsAttr));
  }
}

void RsdparsaSdpAttributeList::LoadFingerprint(
    RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeFingerprint, 8> fingerprintsArray;
  sdp_get_fingerprints(attributeList, &fingerprintsArray);
  if (fingerprintsArray.IsEmpty()) {
    return;
  }
  auto fingerprints = MakeUnique<SdpFingerprintAttributeList>();
  for (const auto& rustFingerprint : fingerprintsArray) {
    std::string algorithm;
    switch (rustFingerprint.hash_algorithm) {
      case ffi::RustSdpAttributeFingerprintHashAlgorithm::Sha1:
        algorithm = "sha-1";
        break;
      case ffi::RustSdpAttributeFingerprintHashAlgorithm::Sha224:
        algorithm = "sha-224";
        break;
      case ffi::RustSdpAttributeFingerprintHashAlgorithm::Sha256:
        algorithm = "sha-256";
        break;
      case ffi::RustSdpAttributeFingerprintHashAlgorithm::Sha384:
        algorithm = "sha-384";
        break;
      case ffi::RustSdpAttributeFingerprintHashAlgorithm::Sha512:
        algorithm = "sha-512";
        break;
    }
    auto span = convertRustSpan(rustFingerprint.fingerprint);
    std::vector<uint8_t> fingerprint(span.begin(), span.end());
    fingerprints->PushEntry(std::move(algorithm), fingerprint);
  }
  SetAttribute(std::move(fingerprints));
}

void RsdparsaSdpAttributeList::LoadDtlsMessage(
    RustAttributeList* attributeList) {
  ffi::RustSdpAttributeDtlsMessage rustDtlsMessage;
  nsresult nr = sdp_get_dtls_message(attributeList, &rustDtlsMessage);
  if (NS_SUCCEEDED(nr)) {
    SdpDtlsMessageAttribute::Role role;
    if (rustDtlsMessage.role == ffi::RustSdpAttributeDtlsMessageRole::Client) {
      role = SdpDtlsMessageAttribute::kClient;
    } else {
      role = SdpDtlsMessageAttribute::kServer;
    }
    SetAttribute(MakeUnique<SdpDtlsMessageAttribute>(
        role, std::string(convertStringView(rustDtlsMessage.value))));
  }
}

void RsdparsaSdpAttributeList::LoadSetup(RustAttributeList* attributeList) {
  ffi::RustSdpAttributeSetup rustSetup;
  nsresult nr = sdp_get_setup(attributeList, &rustSetup);
  if (NS_SUCCEEDED(nr)) {
    SdpSetupAttribute::Role setupEnum;
    switch (rustSetup) {
      case ffi::RustSdpAttributeSetup::Active:
        setupEnum = SdpSetupAttribute::kActive;
        break;
      case ffi::RustSdpAttributeSetup::Actpass:
        setupEnum = SdpSetupAttribute::kActpass;
        break;
      case ffi::RustSdpAttributeSetup::Holdconn:
        setupEnum = SdpSetupAttribute::kHoldconn;
        break;
      case ffi::RustSdpAttributeSetup::Passive:
        setupEnum = SdpSetupAttribute::kPassive;
        break;
    }
    SetAttribute(MakeUnique<SdpSetupAttribute>(setupEnum));
  }
}

void RsdparsaSdpAttributeList::LoadSsrc(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeSsrc, 8> rustSsrcs;
  sdp_get_ssrcs(attributeList, &rustSsrcs);
  if (rustSsrcs.IsEmpty()) {
    return;
  }
  auto ssrcs = MakeUnique<SdpSsrcAttributeList>();
  for (const auto& ssrc : rustSsrcs) {
    std::string attribute(convertStringView(ssrc.attribute));
    std::string value(convertStringView(ssrc.value));
    if (value.empty()) {
      ssrcs->PushEntry(ssrc.id, attribute);
    } else {
      std::string entry{std::move(attribute)};
      entry.push_back(':');
      entry.append(value);
      ssrcs->PushEntry(ssrc.id, entry);
    }
  }
  SetAttribute(std::move(ssrcs));
}

void RsdparsaSdpAttributeList::LoadSsrcGroup(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpSsrcGroup, 8> rustSsrcGroups;
  sdp_get_ssrc_groups(attributeList, &rustSsrcGroups);
  if (rustSsrcGroups.IsEmpty()) {
    return;
  }
  auto ssrcGroups = MakeUnique<SdpSsrcGroupAttributeList>();
  for (const auto& ssrcGroup : rustSsrcGroups) {
    SdpSsrcGroupAttributeList::Semantics semantic;
    switch (ssrcGroup.semantic) {
      case ffi::RustSdpSsrcGroupSemantic::Duplication:
        semantic = SdpSsrcGroupAttributeList::kDup;
        break;
      case ffi::RustSdpSsrcGroupSemantic::ForwardErrorCorrection:
        semantic = SdpSsrcGroupAttributeList::kFec;
        break;
      case ffi::RustSdpSsrcGroupSemantic::ForwardErrorCorrectionFr:
        semantic = SdpSsrcGroupAttributeList::kFecFr;
        break;
      case ffi::RustSdpSsrcGroupSemantic::FlowIdentification:
        semantic = SdpSsrcGroupAttributeList::kFid;
        break;
      case ffi::RustSdpSsrcGroupSemantic::SIM:
        semantic = SdpSsrcGroupAttributeList::kSim;
        break;
    }
    std::vector<uint32_t> ssrcs(ssrcGroup.ssrcs.begin(), ssrcGroup.ssrcs.end());
    ssrcGroups->PushEntry(semantic, ssrcs);
  }
  SetAttribute(std::move(ssrcGroups));
}

struct FmtDefaults {
  uint32_t minimumChannels = 0;
};

std::tuple<SdpRtpmapAttributeList::CodecType, FmtDefaults> strToCodecType(
    const std::string& name) {
  auto codec = SdpRtpmapAttributeList::kOtherCodec;
  FmtDefaults defaults = {0};  // This is tracked to match SIPCC behavior only
  if (!nsCRT::strcasecmp(name.c_str(), "opus")) {
    codec = SdpRtpmapAttributeList::kOpus;
    defaults = {0};
  } else if (!nsCRT::strcasecmp(name.c_str(), "G722")) {
    codec = SdpRtpmapAttributeList::kG722;
    defaults = {1};
  } else if (!nsCRT::strcasecmp(name.c_str(), "PCMU")) {
    codec = SdpRtpmapAttributeList::kPCMU;
    defaults = {1};
  } else if (!nsCRT::strcasecmp(name.c_str(), "PCMA")) {
    codec = SdpRtpmapAttributeList::kPCMA;
    defaults = {1};
  } else if (!nsCRT::strcasecmp(name.c_str(), "VP8")) {
    codec = SdpRtpmapAttributeList::kVP8;
    defaults = {0};
  } else if (!nsCRT::strcasecmp(name.c_str(), "VP9")) {
    codec = SdpRtpmapAttributeList::kVP9;
    defaults = {0};
  } else if (!nsCRT::strcasecmp(name.c_str(), "iLBC")) {
    codec = SdpRtpmapAttributeList::kiLBC;
    defaults = {1};
  } else if (!nsCRT::strcasecmp(name.c_str(), "iSAC")) {
    codec = SdpRtpmapAttributeList::kiSAC;
    defaults = {1};
  } else if (!nsCRT::strcasecmp(name.c_str(), "H264")) {
    codec = SdpRtpmapAttributeList::kH264;
    defaults = {0};
  } else if (!nsCRT::strcasecmp(name.c_str(), "red")) {
    codec = SdpRtpmapAttributeList::kRed;
    defaults = {0};
  } else if (!nsCRT::strcasecmp(name.c_str(), "ulpfec")) {
    codec = SdpRtpmapAttributeList::kUlpfec;
    defaults = {0};
  } else if (!nsCRT::strcasecmp(name.c_str(), "telephone-event")) {
    codec = SdpRtpmapAttributeList::kTelephoneEvent;
    defaults = {1};
  } else if (!nsCRT::strcasecmp(name.c_str(), "rtx")) {
    codec = SdpRtpmapAttributeList::kRtx;
    defaults = {0};
  }
  return std::make_tuple(codec, defaults);
}

void RsdparsaSdpAttributeList::LoadRtpmap(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeRtpmap, 8> rustRtpmaps;
  sdp_get_rtpmaps(attributeList, &rustRtpmaps);
  if (rustRtpmaps.IsEmpty()) {
    return;
  }
  auto rtpmapList = MakeUnique<SdpRtpmapAttributeList>();
  for (const auto& rtpmap : rustRtpmaps) {
    std::string payloadType = std::to_string(rtpmap.payload_type);
    std::string name(convertStringView(rtpmap.codec_name));
    auto [codec, defaults] = strToCodecType(name);
    uint32_t channels = rtpmap.channels;
    if (channels == 0) {
      channels = defaults.minimumChannels;
    }
    rtpmapList->PushEntry(payloadType, codec, name, rtpmap.frequency, channels);
  }
  SetAttribute(std::move(rtpmapList));
}

void RsdparsaSdpAttributeList::LoadFmtp(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeFmtp, 8> rustFmtps;
  sdp_get_fmtp(attributeList, &rustFmtps);
  if (rustFmtps.IsEmpty()) {
    return;
  }
  auto fmtpList = MakeUnique<SdpFmtpAttributeList>();
  for (const auto& fmtp : rustFmtps) {
    uint8_t payloadType = fmtp.payload_type;
    std::string codecName(convertStringView(fmtp.codec_name));
    const ffi::RustSdpAttributeFmtpParameters& rustFmtpParameters =
        fmtp.parameters;

    UniquePtr<SdpFmtpAttributeList::Parameters> fmtpParameters;

    // use the upper case version of the codec name
    std::transform(codecName.begin(), codecName.end(), codecName.begin(),
                   ::toupper);

    if (codecName == "H264") {
      SdpFmtpAttributeList::H264Parameters h264Parameters;

      h264Parameters.packetization_mode = rustFmtpParameters.packetization_mode;
      h264Parameters.level_asymmetry_allowed =
          rustFmtpParameters.level_asymmetry_allowed;
      h264Parameters.profile_level_id = rustFmtpParameters.profile_level_id;
      h264Parameters.max_mbps = rustFmtpParameters.max_mbps;
      h264Parameters.max_fs = rustFmtpParameters.max_fs;
      h264Parameters.max_cpb = rustFmtpParameters.max_cpb;
      h264Parameters.max_dpb = rustFmtpParameters.max_dpb;
      h264Parameters.max_br = rustFmtpParameters.max_br;

      // TODO(bug 1466859): Support sprop-parameter-sets

      fmtpParameters = MakeUnique<SdpFmtpAttributeList::H264Parameters>(
          std::move(h264Parameters));
    } else if (codecName == "OPUS") {
      SdpFmtpAttributeList::OpusParameters opusParameters;

      opusParameters.maxplaybackrate = rustFmtpParameters.maxplaybackrate;
      opusParameters.maxAverageBitrate = rustFmtpParameters.maxaveragebitrate;
      opusParameters.useDTX = rustFmtpParameters.usedtx;
      opusParameters.stereo = rustFmtpParameters.stereo;
      opusParameters.useInBandFec = rustFmtpParameters.useinbandfec;
      opusParameters.frameSizeMs = rustFmtpParameters.ptime;
      opusParameters.minFrameSizeMs = rustFmtpParameters.minptime;
      opusParameters.maxFrameSizeMs = rustFmtpParameters.maxptime;
      opusParameters.useCbr = rustFmtpParameters.cbr;

      fmtpParameters = MakeUnique<SdpFmtpAttributeList::OpusParameters>(
          std::move(opusParameters));
    } else if ((codecName == "VP8") || (codecName == "VP9")) {
      SdpFmtpAttributeList::VP8Parameters vp8Parameters(
          codecName == "VP8" ? SdpRtpmapAttributeList::kVP8
                             : SdpRtpmapAttributeList::kVP9);

      vp8Parameters.max_fs = rustFmtpParameters.max_fs;
      vp8Parameters.max_fr = rustFmtpParameters.max_fr;

      fmtpParameters = MakeUnique<SdpFmtpAttributeList::VP8Parameters>(
          std::move(vp8Parameters));
    } else if (codecName == "TELEPHONE-EVENT") {
      SdpFmtpAttributeList::TelephoneEventParameters telephoneEventParameters;

      telephoneEventParameters.dtmfTones =
          std::string(convertStringView(rustFmtpParameters.dtmf_tones));

      fmtpParameters =
          MakeUnique<SdpFmtpAttributeList::TelephoneEventParameters>(
              std::move(telephoneEventParameters));
    } else if (codecName == "RED") {
      SdpFmtpAttributeList::RedParameters redParameters;

      auto encodings = convertRustSpan(rustFmtpParameters.encodings);
      redParameters.encodings.assign(encodings.begin(), encodings.end());

      fmtpParameters = MakeUnique<SdpFmtpAttributeList::RedParameters>(
          std::move(redParameters));
    } else if (codecName == "RTX") {
      SdpFmtpAttributeList::RtxParameters rtxParameters;

      rtxParameters.apt = rustFmtpParameters.rtx.apt;
      if (rustFmtpParameters.rtx.has_rtx_time) {
        rtxParameters.rtx_time = Some(rustFmtpParameters.rtx.rtx_time);
      }

      fmtpParameters =
          MakeUnique<SdpFmtpAttributeList::RtxParameters>(rtxParameters);
    } else if (codecName == "AV1") {
      SdpFmtpAttributeList::Av1Parameters av1Parameters;

      av1Parameters.profile = rustFmtpParameters.av1.has_profile
                                  ? Some(rustFmtpParameters.av1.profile)
                                  : Nothing();
      av1Parameters.levelIdx = rustFmtpParameters.av1.has_level_idx
                                   ? Some(rustFmtpParameters.av1.level_idx)
                                   : Nothing();
      av1Parameters.tier = rustFmtpParameters.av1.has_tier
                               ? Some(rustFmtpParameters.av1.tier)
                               : Nothing();
      fmtpParameters =
          MakeUnique<SdpFmtpAttributeList::Av1Parameters>(av1Parameters);

    } else {
      // The parameter set is unknown so skip it
      continue;
    }
    fmtpList->PushEntry(std::to_string(payloadType), *fmtpParameters);
  }
  SetAttribute(std::move(fmtpList));
}

void RsdparsaSdpAttributeList::LoadPtime(RustAttributeList* attributeList) {
  int64_t ptime = sdp_get_ptime(attributeList);
  if (ptime >= 0) {
    SetAttribute(MakeUnique<SdpNumberAttribute>(SdpAttribute::kPtimeAttribute,
                                                static_cast<uint32_t>(ptime)));
  }
}

void RsdparsaSdpAttributeList::LoadFlags(RustAttributeList* attributeList) {
  ffi::RustSdpAttributeFlags flags = sdp_get_attribute_flags(attributeList);
  if (flags.ice_lite) {
    SetAttribute(MakeUnique<SdpFlagAttribute>(SdpAttribute::kIceLiteAttribute));
  }
  if (flags.rtcp_mux) {
    SetAttribute(MakeUnique<SdpFlagAttribute>(SdpAttribute::kRtcpMuxAttribute));
  }
  if (flags.rtcp_rsize) {
    SetAttribute(
        MakeUnique<SdpFlagAttribute>(SdpAttribute::kRtcpRsizeAttribute));
  }
  if (flags.bundle_only) {
    SetAttribute(
        MakeUnique<SdpFlagAttribute>(SdpAttribute::kBundleOnlyAttribute));
  }
  if (flags.end_of_candidates) {
    SetAttribute(
        MakeUnique<SdpFlagAttribute>(SdpAttribute::kEndOfCandidatesAttribute));
  }
  if (flags.extmap_allow_mixed) {
    SetAttribute(
        MakeUnique<SdpFlagAttribute>(SdpAttribute::kExtmapAllowMixedAttribute));
  }
}

void RsdparsaSdpAttributeList::LoadMaxMessageSize(
    RustAttributeList* attributeList) {
  int64_t max_msg_size = sdp_get_max_msg_size(attributeList);
  if (max_msg_size >= 0) {
    SetAttribute(
        MakeUnique<SdpNumberAttribute>(SdpAttribute::kMaxMessageSizeAttribute,
                                       static_cast<uint32_t>(max_msg_size)));
  }
}

void RsdparsaSdpAttributeList::LoadMid(RustAttributeList* attributeList) {
  ffi::StringView rustMid;
  if (NS_SUCCEEDED(sdp_get_mid(attributeList, &rustMid))) {
    SetAttribute(MakeUnique<SdpStringAttribute>(
        SdpAttribute::kMidAttribute, std::string(convertStringView(rustMid))));
  }
}

void RsdparsaSdpAttributeList::LoadMsid(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeMsid, 8> rustMsids;
  sdp_get_msids(attributeList, &rustMsids);
  if (rustMsids.IsEmpty()) {
    return;
  }
  auto msids = MakeUnique<SdpMsidAttributeList>();
  for (const auto& msid : rustMsids) {
    msids->PushEntry(std::string(convertStringView(msid.id)),
                     std::string(convertStringView(msid.appdata)));
  }
  SetAttribute(std::move(msids));
}

void RsdparsaSdpAttributeList::LoadMsidSemantics(
    RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeMsidSemantic, 8> rustMsidSemantics;
  sdp_get_msid_semantics(attributeList, &rustMsidSemantics);
  if (rustMsidSemantics.IsEmpty()) {
    return;
  }
  auto msidSemantics = MakeUnique<SdpMsidSemanticAttributeList>();
  for (const auto& rustMsidSemantic : rustMsidSemantics) {
    std::string semantic(convertStringView(rustMsidSemantic.semantic));
    std::vector<std::string> msids;
    msids.reserve(rustMsidSemantic.msids.Length());
    for (const auto& msid : rustMsidSemantic.msids) {
      msids.emplace_back(convertStringView(msid));
    }
    msidSemantics->PushEntry(semantic, msids);
  }
  SetAttribute(std::move(msidSemantics));
}

void RsdparsaSdpAttributeList::LoadGroup(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeGroup, 8> rustGroups;
  sdp_get_groups(attributeList, &rustGroups);
  if (rustGroups.IsEmpty()) {
    return;
  }
  auto groups = MakeUnique<SdpGroupAttributeList>();
  for (const auto& group : rustGroups) {
    SdpGroupAttributeList::Semantics semantic;
    switch (group.semantic) {
      case ffi::RustSdpAttributeGroupSemantic::LipSynchronization:
        semantic = SdpGroupAttributeList::kLs;
        break;
      case ffi::RustSdpAttributeGroupSemantic::FlowIdentification:
        semantic = SdpGroupAttributeList::kFid;
        break;
      case ffi::RustSdpAttributeGroupSemantic::SingleReservationFlow:
        semantic = SdpGroupAttributeList::kSrf;
        break;
      case ffi::RustSdpAttributeGroupSemantic::AlternateNetworkAddressType:
        semantic = SdpGroupAttributeList::kAnat;
        break;
      case ffi::RustSdpAttributeGroupSemantic::ForwardErrorCorrection:
        semantic = SdpGroupAttributeList::kFec;
        break;
      case ffi::RustSdpAttributeGroupSemantic::DecodingDependency:
        semantic = SdpGroupAttributeList::kDdp;
        break;
      case ffi::RustSdpAttributeGroupSemantic::Bundle:
        semantic = SdpGroupAttributeList::kBundle;
        break;
    }
    std::vector<std::string> tags;
    tags.reserve(group.tags.Length());
    for (const auto& tag : group.tags) {
      tags.emplace_back(convertStringView(tag));
    }
    groups->PushEntry(semantic, tags);
  }
  SetAttribute(std::move(groups));
}

void RsdparsaSdpAttributeList::LoadRtcp(RustAttributeList* attributeList) {
  ffi::RustSdpAttributeRtcp rtcp;
  if (NS_SUCCEEDED(sdp_get_rtcp(attributeList, &rtcp))) {
    if (rtcp.has_address) {
      auto address = convertExplicitlyTypedAddress(rtcp.unicast_addr);
      SetAttribute(MakeUnique<SdpRtcpAttribute>(rtcp.port, sdp::kInternet,
                                                address.first, address.second));
    } else {
      SetAttribute(MakeUnique<SdpRtcpAttribute>(rtcp.port));
    }
  }
}

void RsdparsaSdpAttributeList::LoadRtcpFb(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeRtcpFb, 8> rustRtcpfbs;
  sdp_get_rtcpfbs(attributeList, &rustRtcpfbs);
  if (rustRtcpfbs.IsEmpty()) {
    return;
  }

  auto rtcpfbList = MakeUnique<SdpRtcpFbAttributeList>();
  for (const auto& rtcpfb : rustRtcpfbs) {
    uint32_t payloadTypeU32 = rtcpfb.payload_type;

    std::stringstream ss;
    if (payloadTypeU32 == std::numeric_limits<uint32_t>::max()) {
      ss << "*";
    } else {
      ss << payloadTypeU32;
    }

    uint32_t feedbackType = rtcpfb.feedback_type;
    std::string parameter(convertStringView(rtcpfb.parameter));
    std::string extra(convertStringView(rtcpfb.extra));

    rtcpfbList->PushEntry(
        ss.str(), static_cast<SdpRtcpFbAttributeList::Type>(feedbackType),
        parameter, extra);
  }

  SetAttribute(std::move(rtcpfbList));
}

SdpImageattrAttributeList::XYRange LoadImageattrXYRange(
    const ffi::RustSdpAttributeImageAttrXyRange& rustXYRange) {
  SdpImageattrAttributeList::XYRange xyRange;

  auto discreteValues = convertRustSpan(rustXYRange.discrete_values);
  if (discreteValues.empty()) {
    xyRange.min = rustXYRange.min;
    xyRange.max = rustXYRange.max;
    xyRange.step = rustXYRange.step;
  } else {
    xyRange.discreteValues.assign(discreteValues.begin(), discreteValues.end());
  }

  return xyRange;
}

std::vector<SdpImageattrAttributeList::Set> LoadImageattrSets(
    const nsTArray<ffi::RustSdpAttributeImageAttrSet>& rustSets) {
  std::vector<SdpImageattrAttributeList::Set> sets;
  sets.reserve(rustSets.Length());
  for (const auto& rustSet : rustSets) {
    SdpImageattrAttributeList::Set set;

    set.xRange = LoadImageattrXYRange(rustSet.x);
    set.yRange = LoadImageattrXYRange(rustSet.y);

    if (rustSet.has_sar) {
      auto discreteValues = convertRustSpan(rustSet.sar.discrete_values);
      if (discreteValues.empty()) {
        set.sRange.min = rustSet.sar.min;
        set.sRange.max = rustSet.sar.max;
      } else {
        set.sRange.discreteValues.assign(discreteValues.begin(),
                                         discreteValues.end());
      }
    }

    if (rustSet.has_par) {
      set.pRange.min = rustSet.par.min;
      set.pRange.max = rustSet.par.max;
    }

    set.qValue = rustSet.q;

    sets.push_back(std::move(set));
  }

  return sets;
}

void RsdparsaSdpAttributeList::LoadImageattr(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeImageAttr, 8> rustImageattrs;
  sdp_get_imageattrs(attributeList, &rustImageattrs);
  if (rustImageattrs.IsEmpty()) {
    return;
  }
  auto imageattrList = MakeUnique<SdpImageattrAttributeList>();
  for (const auto& rustImageAttr : rustImageattrs) {
    SdpImageattrAttributeList::Imageattr imageAttr;

    if (rustImageAttr.pt != std::numeric_limits<uint32_t>::max()) {
      imageAttr.pt = Some(rustImageAttr.pt);
    }

    if (rustImageAttr.send.is_wildcard) {
      imageAttr.sendAll = true;
    } else {
      imageAttr.sendSets = LoadImageattrSets(rustImageAttr.send.sets);
    }

    if (rustImageAttr.recv.is_wildcard) {
      imageAttr.recvAll = true;
    } else {
      imageAttr.recvSets = LoadImageattrSets(rustImageAttr.recv.sets);
    }

    imageattrList->mImageattrs.push_back(std::move(imageAttr));
  }
  SetAttribute(std::move(imageattrList));
}

void RsdparsaSdpAttributeList::LoadSctpmaps(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeSctpmap, 8> rustSctpmaps;
  sdp_get_sctpmaps(attributeList, &rustSctpmaps);
  if (rustSctpmaps.IsEmpty()) {
    return;
  }
  auto sctpmapList = MakeUnique<SdpSctpmapAttributeList>();
  for (const auto& sctpmap : rustSctpmaps) {
    sctpmapList->PushEntry(std::to_string(sctpmap.port), "webrtc-datachannel",
                           sctpmap.channels);
  }
  SetAttribute(std::move(sctpmapList));
}

static SdpSimulcastAttribute::Versions LoadSimulcastVersions(
    const nsTArray<ffi::RustSdpAttributeSimulcastVersion>& rustVersions) {
  SdpSimulcastAttribute::Versions versions;
  for (const auto& rustVersion : rustVersions) {
    if (rustVersion.ids.IsEmpty()) {
      continue;
    }
    SdpSimulcastAttribute::Version version;
    for (const auto& rustId : rustVersion.ids) {
      std::string id(convertStringView(rustId.id));
      version.choices.push_back(
          SdpSimulcastAttribute::Encoding(std::move(id), rustId.paused));
    }
    versions.push_back(std::move(version));
  }
  return versions;
}

void RsdparsaSdpAttributeList::LoadSimulcast(RustAttributeList* attributeList) {
  ffi::RustSdpAttributeSimulcast rustSimulcast;
  if (NS_SUCCEEDED(sdp_get_simulcast(attributeList, &rustSimulcast))) {
    auto simulcast = MakeUnique<SdpSimulcastAttribute>();

    simulcast->sendVersions = LoadSimulcastVersions(rustSimulcast.send);
    simulcast->recvVersions = LoadSimulcastVersions(rustSimulcast.receive);

    SetAttribute(std::move(simulcast));
  }
}

void RsdparsaSdpAttributeList::LoadDirection(RustAttributeList* attributeList) {
  SdpDirectionAttribute::Direction dir;
  ffi::RustDirection rustDir = sdp_get_direction(attributeList);
  switch (rustDir) {
    case ffi::RustDirection::Recvonly:
      dir = SdpDirectionAttribute::kRecvonly;
      break;
    case ffi::RustDirection::Sendonly:
      dir = SdpDirectionAttribute::kSendonly;
      break;
    case ffi::RustDirection::Sendrecv:
      dir = SdpDirectionAttribute::kSendrecv;
      break;
    case ffi::RustDirection::Inactive:
      dir = SdpDirectionAttribute::kInactive;
      break;
  }
  SetAttribute(MakeUnique<SdpDirectionAttribute>(dir));
}

void RsdparsaSdpAttributeList::LoadRemoteCandidates(
    RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeRemoteCandidate, 8> rustCandidates;
  sdp_get_remote_candidates(attributeList, &rustCandidates);
  if (rustCandidates.IsEmpty()) {
    return;
  }
  std::vector<SdpRemoteCandidatesAttribute::Candidate> candidates;
  candidates.reserve(rustCandidates.Length());
  for (const auto& rustCandidate : rustCandidates) {
    SdpRemoteCandidatesAttribute::Candidate candidate;
    candidate.port = rustCandidate.port;
    candidate.id = std::to_string(rustCandidate.component);
    candidate.address = convertAddress(rustCandidate.address);
    candidates.push_back(std::move(candidate));
  }
  SetAttribute(MakeUnique<SdpRemoteCandidatesAttribute>(candidates));
}

void RsdparsaSdpAttributeList::LoadRids(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeRid, 8> rustRids;
  sdp_get_rids(attributeList, &rustRids);
  if (rustRids.IsEmpty()) {
    return;
  }

  auto ridList = MakeUnique<SdpRidAttributeList>();
  for (const auto& rid : rustRids) {
    std::string id(convertStringView(rid.id));
    auto direction = static_cast<sdp::Direction>(rid.direction);

    auto formatsSpan = convertRustSpan(rid.formats);
    std::vector<uint16_t> formats(formatsSpan.begin(), formatsSpan.end());

    VideoEncodingConstraints parameters;
    parameters.maxWidth = rid.params.max_width;
    parameters.maxHeight = rid.params.max_height;
    // Right now, we treat max-fps=0 and the absence of max-fps as no limit.
    // We will eventually want to treat max-fps=0 as 0 frames per second, and
    // the absence of max-fps as no limit (bug 1762632).
    if (rid.params.max_fps) {
      parameters.maxFps = Some(rid.params.max_fps);
    }
    parameters.maxFs = rid.params.max_fs;
    parameters.maxBr = rid.params.max_br;
    parameters.maxPps = rid.params.max_pps;

    std::vector<std::string> depends;
    depends.reserve(rid.depends.Length());
    for (const auto& dep : rid.depends) {
      depends.emplace_back(convertStringView(dep));
    }

    ridList->PushEntry(id, direction, formats, parameters, depends);
  }

  SetAttribute(std::move(ridList));
}

void RsdparsaSdpAttributeList::LoadSctpPort(RustAttributeList* attributeList) {
  int64_t port = sdp_get_sctp_port(attributeList);
  if (port >= 0) {
    SetAttribute(MakeUnique<SdpNumberAttribute>(
        SdpAttribute::kSctpPortAttribute, static_cast<uint32_t>(port)));
  }
}

void RsdparsaSdpAttributeList::LoadExtmap(RustAttributeList* attributeList) {
  AutoTArray<ffi::RustSdpAttributeExtmap, 8> rustExtmaps;
  sdp_get_extmaps(attributeList, &rustExtmaps);
  if (rustExtmaps.IsEmpty()) {
    return;
  }
  auto extmaps = MakeUnique<SdpExtmapAttributeList>();
  for (const auto& rustExtmap : rustExtmaps) {
    std::string name(convertStringView(rustExtmap.url));
    SdpDirectionAttribute::Direction direction;
    bool directionSpecified = rustExtmap.direction_specified;
    switch (rustExtmap.direction) {
      case ffi::RustDirection::Recvonly:
        direction = SdpDirectionAttribute::kRecvonly;
        break;
      case ffi::RustDirection::Sendonly:
        direction = SdpDirectionAttribute::kSendonly;
        break;
      case ffi::RustDirection::Sendrecv:
        direction = SdpDirectionAttribute::kSendrecv;
        break;
      case ffi::RustDirection::Inactive:
        direction = SdpDirectionAttribute::kInactive;
        break;
    }
    std::string extensionAttributes(
        convertStringView(rustExtmap.extension_attributes));
    extmaps->PushEntry(rustExtmap.id, direction, directionSpecified, name,
                       extensionAttributes);
  }
  SetAttribute(std::move(extmaps));
}

void RsdparsaSdpAttributeList::LoadMaxPtime(RustAttributeList* attributeList) {
  uint64_t maxPtime = 0;
  nsresult nr = sdp_get_maxptime(attributeList, &maxPtime);
  if (NS_SUCCEEDED(nr)) {
    SetAttribute(MakeUnique<SdpNumberAttribute>(
        SdpAttribute::kMaxptimeAttribute, maxPtime));
  }
}

void RsdparsaSdpAttributeList::LoadCandidate(RustAttributeList* attributeList) {
  AutoTArray<nsCString, 8> rustCandidates;
  sdp_get_candidates(attributeList, &rustCandidates);
  if (rustCandidates.IsEmpty()) {
    return;
  }

  std::vector<std::string> candidatesStrings;
  candidatesStrings.reserve(rustCandidates.Length());
  for (const auto& candidate : rustCandidates) {
    candidatesStrings.emplace_back(candidate.get(), candidate.Length());
  }

  auto candidates =
      MakeUnique<SdpMultiStringAttribute>(SdpAttribute::kCandidateAttribute);
  candidates->mValues = std::move(candidatesStrings);

  SetAttribute(std::move(candidates));
}

bool RsdparsaSdpAttributeList::IsAllowedHere(
    const SdpAttribute::AttributeType type) const {
  if (AtSessionLevel() && !SdpAttribute::IsAllowedAtSessionLevel(type)) {
    return false;
  }

  if (!AtSessionLevel() && !SdpAttribute::IsAllowedAtMediaLevel(type)) {
    return false;
  }

  return true;
}

void RsdparsaSdpAttributeList::Serialize(std::ostream& os) const {
  for (auto& mAttribute : mAttributes) {
    if (mAttribute) {
      os << *mAttribute;
    }
  }
}

}  // namespace mozilla
