/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.downloads

import android.app.Dialog
import android.content.DialogInterface
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.WindowManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.fragment.app.DialogFragment
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import mozilla.components.concept.base.crash.Breadcrumb
import mozilla.components.support.base.log.logger.Logger
import mozilla.components.support.ktx.util.PromptAbuserDetector
import mozilla.components.support.utils.OnEnterAnimationCompleteListener
import org.mozilla.fenix.R
import org.mozilla.fenix.ext.components
import org.mozilla.fenix.ext.requireComponents
import org.mozilla.fenix.settings.downloads.DefaultAndroidFileUtils
import org.mozilla.fenix.settings.downloads.DefaultDownloadLocationFormatter
import org.mozilla.fenix.settings.downloads.MissingUriPermission
import org.mozilla.fenix.theme.FirefoxTheme

/**
 * Dialog fragment for renaming downloaded files and changing their save location.
 *
 * This fragment provides a UI for users to:
 * - Modify the file name before download
 * - Select the directory where the file will be saved
 * - Confirm or cancel the download
 *
 * The callback [onConfirmSave] is invoked with the final file name and directory path.
 */
class RenameAndChangeLocationDialogFragment : DialogFragment(), OnEnterAnimationCompleteListener {
    private val logger = Logger("RenameAndChangeLocationDialogFragment")
    private val safeArguments get() = requireNotNull(arguments)

    private val promptAbuserDetector = PromptAbuserDetector(TIME_SHOWN_OFFSET_MILLIS)

    internal val fileName: String
        get() = safeArguments.getString(KEY_FILE_NAME, "")

    internal val directoryPath: String
        get() = safeArguments.getString(KEY_DIRECTORY_PATH, "")

    internal val contentSize: Long
        get() = safeArguments.getLong(KEY_CONTENT_SIZE, 0)

    private var dialogState by mutableStateOf(
        RenameAndChangeLocationDialogState(
            fileName = "",
            directoryPath = "",
        ),
    )
    private lateinit var downloadLocationFormatter: DefaultDownloadLocationFormatter

    var onConfirmSave: (String, String) -> Unit = { _, _ -> }

    var onCancel: () -> Unit = { }

    private val directoryLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            handleSelectedDownloadDirectory(uri)
        }

    override fun onStart() {
        super.onStart()
        dialog?.window?.apply {
            clearFlags(WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM)
        }
    }

    override fun onResume() {
        super.onResume()
        promptAbuserDetector.start()
    }

    override fun onEnterAnimationComplete() {
        promptAbuserDetector.start()
    }

    override fun onCancel(dialog: DialogInterface) {
        super.onCancel(dialog)
        onCancel()
    }

    override fun onDismiss(dialog: DialogInterface) {
        super.onDismiss(dialog)
        requireContext().components.analytics.crashReporter.recordCrashBreadcrumb(
            Breadcrumb("RenameAndChangeLocationDialogFragment onDismiss"),
        )
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        downloadLocationFormatter = DefaultDownloadLocationFormatter(
            fileUtils = DefaultAndroidFileUtils(requireContext()),
        )

        dialogState = RenameAndChangeLocationDialogState(
            fileName = fileName,
            directoryPath = directoryPath,
        )

        val composeView = createComposeView()

        promptAbuserDetector.start()

        return MaterialAlertDialogBuilder(requireContext())
            .setView(composeView)
            .create()
    }

    private fun buildDialogTitle(): String {
        return if (contentSize > 0L) {
            val contentSizeInBytes =
                requireComponents.core.fileSizeFormatter.formatSizeInBytes(contentSize)
            getString(
                R.string.download_rename_and_change_location_dialog_title,
                contentSizeInBytes,
            )
        } else {
            getString(
                R.string.download_rename_and_change_location_dialog_title_with_unknown_size,
            )
        }
    }

    private fun createComposeView(): ComposeView {
        return ComposeView(requireContext()).apply {
            setContent {
                FirefoxTheme {
                    val friendlyPath = try {
                        downloadLocationFormatter.getFriendlyPath(dialogState.directoryPath)
                    } catch (e: MissingUriPermission) {
                        logger.warn("Resetting download location to default due to lost permissions.", e)
                        val defaultLocation = Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS,
                        ).path
                        downloadLocationFormatter.getFriendlyPath(defaultLocation)
                    }

                    RenameAndChangeLocationDialogContent(
                        dialogState = dialogState,
                        friendlyPath = friendlyPath,
                        title = buildDialogTitle(),
                        onFileNameChange = { newFileName ->
                            dialogState = dialogState.copy(fileName = newFileName)
                        },
                        onDirectorySelect = {
                            directoryLauncher.launch(null)
                        },
                        onConfirm = {
                            if (promptAbuserDetector.areDialogsBeingAbused()) {
                                promptAbuserDetector.updateJSDialogAbusedState()
                            } else {
                                onConfirmSave(
                                    dialogState.fileName,
                                    dialogState.directoryPath,
                                )
                                dismiss()
                            }
                        },
                        onCancel = {
                            onCancel()
                            dismiss()
                        },
                    )
                }
            }
        }
    }

    private fun handleSelectedDownloadDirectory(uri: Uri?) {
        val safeUri = uri ?: return

        val flags =
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        try {
            context?.contentResolver?.takePersistableUriPermission(safeUri, flags)

            dialogState = dialogState.copy(directoryPath = uri.toString())
        } catch (e: SecurityException) {
            logger.error(
                "Failed to take persistable URI permission for the selected downloads directory.",
                e,
            )
        }
    }

    companion object {
        private const val KEY_FILE_NAME = "file_name"
        private const val KEY_DIRECTORY_PATH = "directory_path"
        private const val KEY_CONTENT_SIZE = "content_size"
        const val RENAME_AND_CHANGE_LOCATION_DIALOG_TAG = "RENAME_AND_CHANGE_LOCATION_DIALOG_TAG"
        private const val TIME_SHOWN_OFFSET_MILLIS = 500

        /**
         * Creates a new instance of [RenameAndChangeLocationDialogFragment].
         *
         * @param fileName The initial file name.
         * @param directoryPath The initial directory path.
         * @param contentSize The size of the download content in bytes.
         */
        fun newInstance(
            fileName: String,
            directoryPath: String,
            contentSize: Long,
        ) = RenameAndChangeLocationDialogFragment().apply {
            arguments = Bundle().apply {
                putString(KEY_FILE_NAME, fileName)
                putString(KEY_DIRECTORY_PATH, directoryPath)
                putLong(KEY_CONTENT_SIZE, contentSize)
            }
        }
    }
}

/**
 * Starts (or restarts) the time-based check without increasing the "click count".
 *
 * Makes it safe to call from multiple/successive lifecycle methods, without running into the risk
 * of triggering the more restrictive count-based protection on the 1st click (or even before it).
 */
private fun PromptAbuserDetector.start() {
    resetJSAlertAbuseState()
    updateJSDialogAbusedState()
}
