/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#ifndef DOM_MEDIA_WEBRTC_LIBWEBRTCOVERRIDES_MODULES_DESKTOP_CAPTURE_DESKTOP_CAPTURE_TYPES_H_
#define DOM_MEDIA_WEBRTC_LIBWEBRTCOVERRIDES_MODULES_DESKTOP_CAPTURE_DESKTOP_CAPTURE_TYPES_H_

#if defined(XP_WIN) && \
    !defined(__MINGW32__)  // Moving this into the global namespace
typedef int pid_t;         // matching what used to be in
#elif defined(XP_WIN)      // video_capture_defines.h
#  include <sys/types.h>
#endif

#include "../../third_party/libwebrtc/modules/desktop_capture/desktop_capture_types.h"

#endif  // DOM_MEDIA_WEBRTC_LIBWEBRTCOVERRIDES_MODULES_DESKTOP_CAPTURE_DESKTOP_CAPTURE_TYPES_H_
