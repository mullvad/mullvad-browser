/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.downloads

import android.app.Notification
import android.app.PendingIntent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationCompat.EXTRA_PROGRESS
import androidx.core.app.NotificationCompat.EXTRA_PROGRESS_INDETERMINATE
import androidx.core.app.NotificationCompat.EXTRA_PROGRESS_MAX
import androidx.core.content.ContextCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import mozilla.components.browser.state.state.content.DownloadState
import mozilla.components.feature.downloads.AbstractFetchDownloadService.DownloadJobState
import mozilla.components.feature.downloads.fake.FakeFileSizeFormatter
import mozilla.components.support.test.robolectric.testContext
import mozilla.components.support.utils.FakeDateTimeProvider
import mozilla.components.support.utils.FakeDownloadFileUtils
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.mock

@RunWith(AndroidJUnit4::class)
class DownloadNotificationTest {

    private val fakeFileSizeFormatter: FileSizeFormatter = FakeFileSizeFormatter()

    @Test
    fun getProgress() {
        val downloadJobState = DownloadJobState(
            job = null,
            state = DownloadState(
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.DOWNLOADING,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            currentBytesCopied = 10,
            status = DownloadState.Status.DOWNLOADING,
        )

        assertEquals(
            "10 / 100",
            downloadJobState.state.getProgress(
                fileSizeFormatter = fakeFileSizeFormatter,
            ),
        )

        val newDownload = downloadJobState.copy(state = downloadJobState.state.copy(contentLength = null))

        assertEquals(
            "10",
            newDownload.state.getProgress(
                fileSizeFormatter = fakeFileSizeFormatter,
            ),
        )

        val downloadWithNoSize = downloadJobState.copy(state = downloadJobState.state.copy(contentLength = 0))

        assertEquals(
            "10",
            downloadWithNoSize.state.getProgress(
                fileSizeFormatter = fakeFileSizeFormatter,
            ),
        )

        val downloadWithNullSize = downloadJobState.copy(state = downloadJobState.state.copy(contentLength = null))

        assertEquals(
            "10",
            downloadWithNullSize.state.getProgress(
                fileSizeFormatter = fakeFileSizeFormatter,
            ),
        )
    }

    @Test
    fun setCompatGroup() {
        val notificationBuilder = NotificationCompat.Builder(testContext, "")
            .setCompatGroup("myGroup").build()

        assertEquals("myGroup", notificationBuilder.group)
    }

    @Test
    fun getStatusDescription() {
        val pausedText = testContext.getString(R.string.mozac_feature_downloads_paused_notification_text)
        val completedText = testContext.getString(R.string.mozac_feature_downloads_completed_notification_text2)
        val failedText = testContext.getString(R.string.mozac_feature_downloads_failed_notification_text2)
        var downloadJobState = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.DOWNLOADING,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            status = DownloadState.Status.DOWNLOADING,
            currentBytesCopied = 10,
        )

        assertEquals(
            downloadJobState.state.getProgress(
                fakeFileSizeFormatter,
            ),
            downloadJobState.state.getStatusDescription(
                context = testContext,
                fileSizeFormatter = fakeFileSizeFormatter,
            ),
        )

        downloadJobState = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.PAUSED,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            status = DownloadState.Status.PAUSED,
        )

        assertEquals(
            pausedText,
            downloadJobState.state.getStatusDescription(
                context = testContext,
                fileSizeFormatter = fakeFileSizeFormatter,
            ),
        )

        downloadJobState = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.COMPLETED,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            status = DownloadState.Status.COMPLETED,
        )

        assertEquals(
            completedText,
            downloadJobState.state.getStatusDescription(
                context = testContext,
                fileSizeFormatter = fakeFileSizeFormatter,
            ),
        )

        downloadJobState = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.FAILED,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            status = DownloadState.Status.FAILED,
        )

        assertEquals(
            failedText,
            downloadJobState.state.getStatusDescription(
                context = testContext,
                fileSizeFormatter = fakeFileSizeFormatter,
            ),
        )

        downloadJobState = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.CANCELLED,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            status = DownloadState.Status.CANCELLED,
        )

        assertEquals(
            "",
            downloadJobState.state.getStatusDescription(
                context = testContext,
                fileSizeFormatter = fakeFileSizeFormatter,
            ),
        )
    }

    @Test
    fun getDownloadSummary() {
        val download1 = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.DOWNLOADING,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            currentBytesCopied = 10,
            status = DownloadState.Status.DOWNLOADING,
        )
        val download2 = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla2.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 20,
                status = DownloadState.Status.DOWNLOADING,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            currentBytesCopied = 20,
            status = DownloadState.Status.DOWNLOADING,
        )

        val summary = DownloadNotification.getSummaryList(
            context = testContext,
            fileSizeFormatter = fakeFileSizeFormatter,
            notifications = listOf(download1, download2),
        )
        assertEquals(listOf("mozilla.txt 10 / 100", "mozilla2.txt 20 / 100"), summary)
    }

    @Test
    fun `createOngoingDownloadNotification progress does not overflow`() {
        val size = 3 * 1024L * 1024L * 1024L
        val copiedSize = size / 2
        val downloadJobState = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = size,
                currentBytesCopied = copiedSize,
                status = DownloadState.Status.DOWNLOADING,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            currentBytesCopied = copiedSize,
            status = DownloadState.Status.DOWNLOADING,
        )

        val style = AbstractFetchDownloadService.Style()

        val notification = DownloadNotification.createOngoingDownloadNotification(
            context = testContext,
            downloadState = downloadJobState.state,
            fileSizeFormatter = fakeFileSizeFormatter,
            notificationAccentColor = style.notificationAccentColor,
            downloadEstimator = DownloadEstimator(
                dateTimeProvider = FakeDateTimeProvider(),
            ),
        )

        assertEquals(
            50L,
            100L * notification.extras.getInt(EXTRA_PROGRESS) / notification.extras.getInt(EXTRA_PROGRESS_MAX),
        )

        assertEquals(false, notification.extras.getBoolean(EXTRA_PROGRESS_INDETERMINATE))

        val notificationNewDownload = DownloadNotification.createOngoingDownloadNotification(
            context = testContext,
            downloadState = downloadJobState.state.copy(contentLength = null),
            fileSizeFormatter = fakeFileSizeFormatter,
            notificationAccentColor = style.notificationAccentColor,
            downloadEstimator = DownloadEstimator(
                dateTimeProvider = FakeDateTimeProvider(),
            ),
        )

        assertEquals(true, notificationNewDownload.extras.getBoolean(EXTRA_PROGRESS_INDETERMINATE))

        val notificationDownloadWithNoSize = DownloadNotification.createOngoingDownloadNotification(
            context = testContext,
            downloadState = downloadJobState.state.copy(contentLength = 0),
            fileSizeFormatter = fakeFileSizeFormatter,
            notificationAccentColor = style.notificationAccentColor,
            downloadEstimator = DownloadEstimator(
                dateTimeProvider = FakeDateTimeProvider(),
            ),
        )

        assertEquals(true, notificationDownloadWithNoSize.extras.getBoolean(EXTRA_PROGRESS_INDETERMINATE))
    }

    @Test
    fun `createOngoingDownloadNotification with long filename truncates from middle`() {
        val longFileName = "this_is_a_very_long_filename_that_exceeds_forty_characters_to_test_truncation.pdf"
        val downloadState =
            DownloadState(
                fileName = longFileName,
                url = "mozilla.org/file.pdf",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.DOWNLOADING,
            )
        val style = AbstractFetchDownloadService.Style()

        val notification =
            DownloadNotification.createOngoingDownloadNotification(
                context = testContext,
                downloadState = downloadState,
                fileSizeFormatter = fakeFileSizeFormatter,
                notificationAccentColor = style.notificationAccentColor,
                downloadEstimator = DownloadEstimator(dateTimeProvider = FakeDateTimeProvider()),
            )

        val expectedTitle = "this_is_a_ve…uncation.pdf"
        assertEquals(expectedTitle, notification.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
    }

    @Test
    fun getOngoingNotificationAccentColor() {
        val download = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.DOWNLOADING,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            currentBytesCopied = 10,
            status = DownloadState.Status.DOWNLOADING,
        )

        val style = AbstractFetchDownloadService.Style()

        val notification = DownloadNotification.createOngoingDownloadNotification(
            context = testContext,
            downloadState = download.state,
            fileSizeFormatter = fakeFileSizeFormatter,
            notificationAccentColor = style.notificationAccentColor,
            downloadEstimator = DownloadEstimator(
                dateTimeProvider = FakeDateTimeProvider(),
            ),
        )

        val accentColor = ContextCompat.getColor(testContext, style.notificationAccentColor)

        assertEquals(accentColor, notification.color)
    }

    @Test
    fun getPausedNotificationAccentColor() {
        val download = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.PAUSED,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            currentBytesCopied = 10,
            status = DownloadState.Status.PAUSED,
        )

        val style = AbstractFetchDownloadService.Style()

        val notification = DownloadNotification.createPausedDownloadNotification(
            testContext,
            download.state,
            download.createdTime,
            notificationAccentColor = style.notificationAccentColor,
        )

        val accentColor = ContextCompat.getColor(testContext, style.notificationAccentColor)

        assertEquals(accentColor, notification.color)
    }

    @Test
    fun getCompletedNotificationAccentColor() {
        val download = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.COMPLETED,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            currentBytesCopied = 10,
            status = DownloadState.Status.COMPLETED,
        )

        val style = AbstractFetchDownloadService.Style()

        val notification = DownloadNotification.createDownloadCompletedNotification(
            context = testContext,
            downloadState = download.state,
            createdTime = download.createdTime,
            notificationAccentColor = style.notificationAccentColor,
            downloadFileUtils = FakeDownloadFileUtils(),
            contentIntent = mock(PendingIntent::class.java),
        )

        val accentColor = ContextCompat.getColor(testContext, style.notificationAccentColor)

        assertEquals(accentColor, notification.color)
    }

    @Test
    fun getFailedNotificationAccentColor() {
        val download = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.FAILED,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            currentBytesCopied = 10,
            status = DownloadState.Status.FAILED,
        )

        val style = AbstractFetchDownloadService.Style()

        val notification = DownloadNotification.createDownloadFailedNotification(
            testContext,
            download.state,
            download.createdTime,
            notificationAccentColor = style.notificationAccentColor,
        )

        val accentColor = ContextCompat.getColor(testContext, style.notificationAccentColor)

        assertEquals(accentColor, notification.color)
    }

    @Test
    fun getGroupNotificationAccentColor() {
        val download1 = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.DOWNLOADING,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            currentBytesCopied = 10,
            status = DownloadState.Status.DOWNLOADING,
        )

        val download2 = DownloadJobState(
            job = null,
            state = DownloadState(
                fileName = "mozilla.txt",
                url = "mozilla.org/mozilla.txt",
                contentLength = 100L,
                currentBytesCopied = 10,
                status = DownloadState.Status.DOWNLOADING,
            ),
            foregroundServiceId = 1,
            downloadDeleted = false,
            currentBytesCopied = 10,
            status = DownloadState.Status.DOWNLOADING,
        )

        val style = AbstractFetchDownloadService.Style()

        val notification = DownloadNotification.createDownloadGroupNotification(
            context = testContext,
            fileSizeFormatter = fakeFileSizeFormatter,
            notifications = listOf(download1, download2),
            notificationAccentColor = style.notificationAccentColor,
        )

        val accentColor = ContextCompat.getColor(testContext, style.notificationAccentColor)

        assertEquals(accentColor, notification.color)
    }
}
