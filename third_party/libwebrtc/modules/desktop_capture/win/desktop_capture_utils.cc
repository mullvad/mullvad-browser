/*
 *  Copyright (c) 2020 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree. An additional intellectual property rights grant can be found
 *  in the file PATENTS.  All contributing project authors may
 *  be found in the AUTHORS file in the root of the source tree.
 */

#include "modules/desktop_capture/win/desktop_capture_utils.h"

#include <string>
#include <vector>

#include "rtc_base/strings/string_builder.h"
#include "stringapiset.h"

namespace webrtc {
namespace desktop_capture {
namespace utils {

// Generates a human-readable string from a COM error.
std::string ComErrorToString(const _com_error& error) {
  webrtc::StringBuilder string_builder;
  string_builder.AppendFormat("HRESULT: 0x%08X, Message: ", error.Error());
#ifdef _UNICODE
  int size = WideCharToMultiByte(CP_UTF8, 0, error.ErrorMessage(), -1, nullptr,
                                 0, nullptr, nullptr);
  if (size > 0) {
    std::vector<char> buffer(static_cast<size_t>(size));
    WideCharToMultiByte(CP_UTF8, 0, error.ErrorMessage(), -1, buffer.data(),
                        size, nullptr, nullptr);
    string_builder << buffer.data();
  }
#else
  string_builder << error.ErrorMessage();
#endif
  return string_builder.str();
}

}  // namespace utils
}  // namespace desktop_capture
}  // namespace webrtc
