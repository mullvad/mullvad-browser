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

#include <cstdio>
#include <cstdlib>
#include "stringapiset.h"

namespace webrtc {
namespace desktop_capture {
namespace utils {

// Generates a human-readable string from a COM error.
std::string ComErrorToString(const _com_error& error) {
  char buffer[1024];
  rtc::SimpleStringBuilder string_builder(buffer);
  string_builder.AppendFormat("HRESULT: 0x%08X, Message: ", error.Error());
#ifdef _UNICODE
  WideCharToMultiByte(CP_UTF8, 0, error.ErrorMessage(), -1,
                      buffer + string_builder.size(),
                      sizeof(buffer) - string_builder.size(), nullptr, nullptr);
  buffer[sizeof(buffer) - 1] = 0;
#else
  string_builder << error.ErrorMessage();
#endif
  return buffer;
}

}  // namespace utils
}  // namespace desktop_capture
}  // namespace webrtc
