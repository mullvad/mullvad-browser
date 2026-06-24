/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#ifndef include_gfx_ipc_UiCompositorControllerChild_h
#define include_gfx_ipc_UiCompositorControllerChild_h

#include "mozilla/layers/PUiCompositorControllerChild.h"

#include "mozilla/gfx/2D.h"
#include "mozilla/Maybe.h"
#include "mozilla/layers/UiCompositorControllerParent.h"
#include "mozilla/RefPtr.h"
#include "nsThread.h"
#ifdef MOZ_WIDGET_ANDROID
#  include "SurfaceTexture.h"
#  include "mozilla/java/CompositorSurfaceManagerWrappers.h"
#endif

class nsIWidget;

namespace mozilla {
namespace layers {

class AndroidHardwareBuffer;

class UiCompositorControllerChild final
    : protected PUiCompositorControllerChild {
  friend class PUiCompositorControllerChild;

 public:
  NS_INLINE_DECL_THREADSAFE_REFCOUNTING(UiCompositorControllerChild, final)

  static RefPtr<UiCompositorControllerChild> CreateForSameProcess(
      const LayersId& aRootLayerTreeId, nsIWidget* aWidget);
  static RefPtr<UiCompositorControllerChild> CreateForGPUProcess(
      const uint64_t& aProcessToken,
      Endpoint<PUiCompositorControllerChild>&& aEndpoint, nsIWidget* aWidget);

  bool Pause();
  bool Resume();
  bool ResumeAndResize(const int32_t& aX, const int32_t& aY,
                       const int32_t& aHeight, const int32_t& aWidth);
  bool InvalidateAndRender();
  bool SetMaxToolbarHeight(const int32_t& aHeight);
  bool SetFixedBottomOffset(int32_t aOffset);
  bool ToolbarAnimatorMessageFromUI(const int32_t& aMessage);
  bool SetDefaultClearColor(const uint32_t& aColor);
#ifdef MOZ_WIDGET_ANDROID
  using ScreenPixelsPromise =
      MozPromise<RefPtr<layers::AndroidHardwareBuffer>, nsresult, true>;
  RefPtr<ScreenPixelsPromise> RequestScreenPixels(gfx::IntRect aSourceRect,
                                                  gfx::IntSize aDestSize);
#endif
  bool EnableLayerUpdateNotifications(const bool& aEnable);

  void Destroy();

#ifdef MOZ_WIDGET_ANDROID
  // Set mCompositorSurfaceManager. Must be called straight after initialization
  // for GPU process controllers. Do not call for in-process controllers. This
  // is separate from CreateForGPUProcess to avoid cluttering its declaration
  // with JNI types.
  void SetCompositorSurfaceManager(
      java::CompositorSurfaceManager::Param aCompositorSurfaceManager);

  // Send a Surface to the GPU process that a given widget ID should be
  // composited in to. If not using a GPU process this function does nothing, as
  // the InProcessCompositorWidget can read the Surface directly from the
  // widget.
  //
  // Note that this function does not actually use the PUiCompositorController
  // IPDL protocol, and instead uses Android's binder IPC mechanism via
  // mCompositorSurfaceManager. It can be called from any thread.
  void OnCompositorSurfaceChanged(int32_t aWidgetId,
                                  java::sdk::Surface::Param aSurface);
#endif

 protected:
  void ActorDestroy(ActorDestroyReason aWhy) override;
  void ProcessingError(Result aCode, const char* aReason) override;
  void HandleFatalError(const char* aMsg) override;
  mozilla::ipc::IPCResult RecvToolbarAnimatorMessageFromCompositor(
      const int32_t& aMessage);
  mozilla::ipc::IPCResult RecvNotifyCompositorScrollUpdate(
      const CompositorScrollUpdate& aUpdate);
  mozilla::ipc::IPCResult RecvScreenPixels(
      uint64_t aRequestId, bool aSuccess,
      Maybe<ipc::FileDescriptor>&& aAcquireFence);

 private:
  explicit UiCompositorControllerChild(const uint64_t& aProcessToken,
                                       nsIWidget* aWidget);
  virtual ~UiCompositorControllerChild();
  void OpenForSameProcess();
  void OpenForGPUProcess(Endpoint<PUiCompositorControllerChild>&& aEndpoint);
  void SendCachedValues();

  void SetReplyTimeout();
  bool ShouldContinueFromReplyTimeout() override;

  bool mIsOpen;
  uint64_t mProcessToken;
  Maybe<gfx::IntRect> mResize;
  Maybe<int32_t> mMaxToolbarHeight;
  Maybe<uint32_t> mDefaultClearColor;
  Maybe<bool> mLayerUpdateEnabled;
  RefPtr<nsIWidget> mWidget;

#ifdef MOZ_WIDGET_ANDROID
  // Promise created by RequestScreenPixels() that will be resolved when the
  // result is returned by RecvScreenPixels(). The uint64_t is assigned from a
  // monotonic counter and is unique for each request sent. It is used to check
  // whether a received result is for the most recent request made.
  // In an ideal world PUiCompositorControllerChild::SendRequestScreenPixels()
  // would return a promise and RequestScreenPixels() could just chain to that
  // rather than managing its own promise. This would allow us to remove
  // RecvScreenPixels() altogether. Unfortunately, however, we cannot chain to a
  // promise returned from an IPDL function on the Android UI thread, as the
  // thread does not support direct task dispatch.
  struct ScreenPixelsRequest {
    uint64_t mRequestId;
    RefPtr<layers::AndroidHardwareBuffer> mHardwareBuffer;
    RefPtr<ScreenPixelsPromise::Private> mPromise;
  };
  Maybe<ScreenPixelsRequest> mScreenPixelsRequest;
#endif

  // Should only be set when compositor is in process.
  RefPtr<UiCompositorControllerParent> mParent;

#ifdef MOZ_WIDGET_ANDROID
  // Android interface to send Surfaces to the GPU process. This uses Android
  // binder rather than IPDL because Surfaces cannot be sent via IPDL. It lives
  // here regardless because it is a conceptually logical location, even if the
  // underlying IPC mechanism is different.
  // This will be null if there is no GPU process.
  mozilla::java::CompositorSurfaceManager::GlobalRef mCompositorSurfaceManager;
#endif
};

}  // namespace layers
}  // namespace mozilla

#endif  // include_gfx_ipc_UiCompositorControllerChild_h
