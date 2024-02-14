/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef __DEFAULT_BROWSER_AGENT_EVENT_LOG_H__
#define __DEFAULT_BROWSER_AGENT_EVENT_LOG_H__

#include <cwchar>

MOZ_BEGIN_EXTERN_C

extern MOZ_EXPORT const wchar_t* gWinEventLogSourceName;

MOZ_END_EXTERN_C

#ifdef LOG_ERRORS_FILE
extern FILE* gLogFile;
#  define LOG_ERROR(hr)                                                 \
    if (gLogFile) {                                                     \
      fprintf(gLogFile, "Error in %s:%d: 0x%X\r\n", __FILE__, __LINE__, \
              (unsigned int)hr);                                        \
    }
#  define LOG_ERROR_MESSAGE(format, ...)                     \
    if (gLogFile) {                                          \
      fwprintf(gLogFile, format __VA_OPT__(, ) __VA_ARGS__); \
      fputs("\r\n", gLogFile);                               \
    }
#else
#  define LOG_ERROR(hr)
#  define LOG_ERROR_MESSAGE(format, ...)
#endif

#endif  // __DEFAULT_BROWSER_AGENT_EVENT_LOG_H__
