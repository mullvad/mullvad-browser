/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.downloads.listscreen.middleware

import android.content.Context
import mozilla.components.browser.state.state.content.DownloadState
import mozilla.components.feature.downloads.DownloadEstimator
import mozilla.components.feature.downloads.FileSizeFormatter
import mozilla.components.lib.publicsuffixlist.PublicSuffixList
import org.mozilla.fenix.R
import org.mozilla.fenix.downloads.listscreen.store.FileItem
import kotlin.time.Duration.Companion.seconds
import org.mozilla.fenix.ext.toDownloadDisplayUrl

/**
 * Interface for providing the description of the [FileItem]s on the downloads screen.
 */
interface FileItemDescriptionProvider {

    /**
     * Get the description of the [FileItem].
     *
     * @param downloadState The download state of the file item.
     */
    suspend fun getDescription(
        downloadState: DownloadState,
    ): String
}

/**
 * The default implementation of [FileItemDescriptionProvider].
 *
 * @param context The Android context used to retrieve string resources and retrieve the [DateTimeProvider].
 * @param fileSizeFormatter [FileSizeFormatter] used to format the size of the file item.
 * @param downloadEstimator [DownloadEstimator] used to estimate the download time remaining.
 * @param publicSuffixList [PublicSuffixList] used to transform the URL for display.
 */
class DefaultFileItemDescriptionProvider(
    private val context: Context,
    private val fileSizeFormatter: FileSizeFormatter,
    private val downloadEstimator: DownloadEstimator,
    private val publicSuffixList: PublicSuffixList,
) : FileItemDescriptionProvider {

    override suspend fun getDescription(
        downloadState: DownloadState,
    ): String = when (downloadState.status) {
        DownloadState.Status.COMPLETED -> {
            val formattedContentLength = fileSizeFormatter.formatSizeInBytes(downloadState.contentLength ?: 0)
            val shortenedUrl =
                downloadState.url.toDownloadDisplayUrl(
                    publicSuffixList,
                    dataLabel = context.getString(R.string.download_item_source_data),
                )
            // If the shortenedUrl returns an empty string, only the byte count will be displayed.
            listOf(formattedContentLength, shortenedUrl).filter { it.isNotEmpty() }.joinToString(" • ")
        }
        DownloadState.Status.FAILED -> context.getString(R.string.download_item_status_failed)
        DownloadState.Status.CANCELLED -> "" // Cancelled downloads are not shown
        DownloadState.Status.PAUSED -> {
            val contentLength = downloadState.contentLength?.takeIf { it > 0 }

            if (contentLength == null) {
                context.getString(
                    R.string.download_item_paused_description_unknown_total_size,
                    fileSizeFormatter.formatSizeInBytes(downloadState.currentBytesCopied),
                )
            } else {
                context.getString(
                    R.string.download_item_paused_description,
                    fileSizeFormatter.formatSizeInBytes(downloadState.currentBytesCopied),
                    fileSizeFormatter.formatSizeInBytes(contentLength),
                )
            }
        }
        DownloadState.Status.INITIATED -> context.getString(
            R.string.download_item_in_progress_description_preparing,
        )
        DownloadState.Status.DOWNLOADING -> {
            val contentLength = downloadState.contentLength?.takeIf { it > 0 }

            if (contentLength == null) {
                context.getString(
                    R.string.download_item_in_progress_description_unknown_total_size,
                    fileSizeFormatter.formatSizeInBytes(downloadState.currentBytesCopied),
                )
            } else {
                val estimatedSecsRemaining = downloadEstimator.estimatedRemainingTime(
                    startTime = downloadState.createdTime,
                    bytesDownloaded = downloadState.currentBytesCopied,
                    totalBytes = contentLength,
                )

                if (estimatedSecsRemaining == null) {
                    context.getString(
                        R.string.download_item_in_progress_description_pending,
                        fileSizeFormatter.formatSizeInBytes(downloadState.currentBytesCopied),
                        fileSizeFormatter.formatSizeInBytes(contentLength),
                    )
                } else {
                    context.getString(
                        R.string.download_item_in_progress_description_2,
                        fileSizeFormatter.formatSizeInBytes(downloadState.currentBytesCopied),
                        fileSizeFormatter.formatSizeInBytes(contentLength),
                        estimatedSecsRemaining.seconds.toString(),
                    )
                }
            }
        }
    }
}
