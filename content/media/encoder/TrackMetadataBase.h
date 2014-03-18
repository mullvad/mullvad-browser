/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*-*/
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef TrackMetadataBase_h_
#define TrackMetadataBase_h_

#include "nsTArray.h"
#include "nsCOMPtr.h"
namespace mozilla {

// A class represent meta data for various codec format. Only support one track information.
class TrackMetadataBase
{
public:
  NS_INLINE_DECL_THREADSAFE_REFCOUNTING(TrackMetadataBase)
  enum MetadataKind {
    METADATA_OPUS,    // Represent the Opus metadata
    METADATA_VP8,
    METADATA_VORBIS,
    METADATA_AVC,
    METADATA_AAC,
    METADATA_UNKNOWN  // Metadata Kind not set
  };
  virtual ~TrackMetadataBase() {}
  // Return the specific metadata kind
  virtual MetadataKind GetKind() const = 0;
};

// The base class for audio metadata.
class AudioTrackMetadata : public TrackMetadataBase {
public:
  // The duration of each sample set generated by encoder. (counted by samples)
  // If the duration is variant, this value should return 0.
  virtual uint32_t GetAudioFrameDuration() = 0;
  // The size of each sample set generated by encoder. (counted by byte)
  // If the size is variant, this value should return 0.
  virtual uint32_t GetAudioFrameSize() = 0;
  // AudioSampleRate is the number of audio sample per second.
  virtual uint32_t GetAudioSampleRate() = 0;
  virtual uint32_t GetAudioChannels() = 0;
};

// The base class for video metadata.
class VideoTrackMetadata : public TrackMetadataBase {
public:
  virtual uint32_t GetVideoHeight() = 0;
  virtual uint32_t GetVideoWidth() = 0;
  // VideoClockRate is the number of samples per second in video frame's
  // timestamp.
  // For example, if VideoClockRate is 90k Hz and VideoFrameRate is
  // 30 fps, each frame's sample duration will be 3000 Hz.
  virtual uint32_t GetVideoClockRate() = 0;
  // VideoFrameRate is numner of frames per second.
  virtual uint32_t GetVideoFrameRate() = 0;
};

}
#endif
