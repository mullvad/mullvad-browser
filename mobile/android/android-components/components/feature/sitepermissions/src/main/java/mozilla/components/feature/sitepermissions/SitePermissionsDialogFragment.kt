/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.feature.sitepermissions

import android.annotation.SuppressLint
import android.app.Dialog
import android.content.DialogInterface
import android.content.Intent
import android.content.Intent.FLAG_ACTIVITY_NEW_TASK
import android.graphics.Color
import android.os.Bundle
import android.provider.Settings
import android.view.LayoutInflater
import android.view.View
import android.view.View.VISIBLE
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.CheckBox
import android.widget.ImageView
import android.widget.LinearLayout.LayoutParams
import android.widget.TextView
import androidx.annotation.VisibleForTesting
import androidx.appcompat.content.res.AppCompatResources
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toDrawable
import mozilla.components.support.base.android.NoObscuredTouchesDialogFragment
import mozilla.components.support.base.log.logger.Logger
import mozilla.components.support.ktx.android.content.appName
import mozilla.components.support.ktx.kotlin.ifNullOrEmpty
import mozilla.components.support.ktx.util.PromptAbuserDetector
import mozilla.components.support.utils.OnEnterAnimationCompleteListener

internal const val KEY_SESSION_ID = "KEY_SESSION_ID"
internal const val KEY_TITLE = "KEY_TITLE"
private const val KEY_DIALOG_GRAVITY = "KEY_DIALOG_GRAVITY"
private const val KEY_DIALOG_WIDTH_MATCH_PARENT = "KEY_DIALOG_WIDTH_MATCH_PARENT"
private const val KEY_TITLE_ICON = "KEY_TITLE_ICON"
private const val KEY_MESSAGE = "KEY_MESSAGE"
private const val KEY_NEGATIVE_BUTTON_TEXT = "KEY_NEGATIVE_BUTTON_TEXT"
private const val KEY_POSITIVE_BUTTON_BACKGROUND_COLOR = "KEY_POSITIVE_BUTTON_BACKGROUND_COLOR"
private const val KEY_POSITIVE_BUTTON_TEXT_COLOR = "KEY_POSITIVE_BUTTON_TEXT_COLOR"
private const val KEY_LEARN_MORE_LINK = "KEY_LEARN_MORE_LINK"
private const val KEY_SHOULD_SHOW_DO_NOT_ASK_AGAIN_CHECKBOX = "KEY_SHOULD_SHOW_DO_NOT_ASK_AGAIN_CHECKBOX"
private const val KEY_SHOULD_PRESELECT_DO_NOT_ASK_AGAIN_CHECKBOX = "KEY_SHOULD_PRESELECT_DO_NOT_ASK_AGAIN_CHECKBOX"

private const val KEY_DO_NOT_ASK_AGAIN_CHECKBOX_LABEL = "KEY_DO_NOT_ASK_AGAIN_CHECKBOX_LABEL"
private const val KEY_IS_NOTIFICATION_REQUEST = "KEY_IS_NOTIFICATION_REQUEST"
private const val DEFAULT_VALUE = Int.MAX_VALUE
private const val KEY_PERMISSION_ID = "KEY_PERMISSION_ID"

internal open class SitePermissionsDialogFragment :
    NoObscuredTouchesDialogFragment(),
    OnEnterAnimationCompleteListener {

    private val logger = Logger("SitePermissionsDialogFragment")

    @VisibleForTesting
    internal var promptAbuserDetector =
        PromptAbuserDetector(maxSuccessiveDialogMillisLimit = TIME_SHOWN_OFFSET_MILLIS)
    // Safe Arguments

    private val safeArguments get() = requireNotNull(arguments)

    internal val sessionId: String get() =
        safeArguments.getString(KEY_SESSION_ID, "")
    internal val title: String get() =
        safeArguments.getString(KEY_TITLE, "")
    internal val icon get() =
        safeArguments.getInt(KEY_TITLE_ICON, DEFAULT_VALUE)
    internal val message: String? get() =
        safeArguments.getString(KEY_MESSAGE, null)
    internal val negativeButtonText: String? get() =
        safeArguments.getString(KEY_NEGATIVE_BUTTON_TEXT, null)

    internal val dialogGravity: Int get() =
        safeArguments.getInt(KEY_DIALOG_GRAVITY, DEFAULT_VALUE)
    internal val dialogShouldWidthMatchParent: Boolean get() =
        safeArguments.getBoolean(KEY_DIALOG_WIDTH_MATCH_PARENT)

    internal val positiveButtonBackgroundColor get() =
        safeArguments.getInt(KEY_POSITIVE_BUTTON_BACKGROUND_COLOR, DEFAULT_VALUE)
    internal val positiveButtonTextColor get() =
        safeArguments.getInt(KEY_POSITIVE_BUTTON_TEXT_COLOR, DEFAULT_VALUE)

    internal val isNotificationRequest get() =
        safeArguments.getBoolean(KEY_IS_NOTIFICATION_REQUEST, false)
    internal val learnMoreLink: String get() =
        safeArguments.getString(KEY_LEARN_MORE_LINK, "")
    internal val shouldShowDoNotAskAgainCheckBox: Boolean get() =
        safeArguments.getBoolean(KEY_SHOULD_SHOW_DO_NOT_ASK_AGAIN_CHECKBOX, true)
    internal val shouldPreselectDoNotAskAgainCheckBox: Boolean get() =
        safeArguments.getBoolean(KEY_SHOULD_PRESELECT_DO_NOT_ASK_AGAIN_CHECKBOX, false)
    internal val doNotAskAgainCheckBoxLabel: String? get() =
        safeArguments.getString(KEY_DO_NOT_ASK_AGAIN_CHECKBOX_LABEL, null)
    internal val permissionRequestId: String get() =
        safeArguments.getString(KEY_PERMISSION_ID, "")

    // State

    internal var feature: SitePermissionsFeature? = null
    internal var userSelectionCheckBox: Boolean = false

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        userSelectionCheckBox = shouldPreselectDoNotAskAgainCheckBox

        val sheetDialog = Dialog(requireContext())
        sheetDialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        sheetDialog.setCanceledOnTouchOutside(true)

        val rootView = createContainer()

        sheetDialog.setContainerView(rootView)

        sheetDialog.window?.apply {
            if (dialogGravity != DEFAULT_VALUE) {
                setGravity(dialogGravity)
            }

            if (dialogShouldWidthMatchParent) {
                setBackgroundDrawable(Color.TRANSPARENT.toDrawable())
                // This must be called after addContentView, or it won't fully fill to the edge.
                setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            }
        }

        promptAbuserDetector.updateJSDialogAbusedState()

        return sheetDialog
    }

    override fun onDismiss(dialog: DialogInterface) {
        super.onDismiss(dialog)
        feature?.onDismiss(permissionRequestId, sessionId)
    }

    override fun onEnterAnimationComplete() {
        // Extend the positive button click delay.
        promptAbuserDetector.updateJSDialogAbusedState()
    }

    private fun Dialog.setContainerView(rootView: View) {
        if (dialogShouldWidthMatchParent) {
            setContentView(rootView)
        } else {
            addContentView(
                rootView,
                LayoutParams(
                    LayoutParams.MATCH_PARENT,
                    LayoutParams.MATCH_PARENT,
                ),
            )
        }
    }

    @SuppressLint("InflateParams")
    private fun createContainer(): View {
        val rootView = LayoutInflater.from(requireContext()).inflate(
            R.layout.mozac_site_permissions_prompt,
            null,
            false,
        )

        rootView.findViewById<TextView>(R.id.title).text = title
        rootView.findViewById<ImageView>(R.id.icon).setImageResource(icon)
        message?.let {
            rootView.findViewById<TextView>(R.id.message).apply {
                visibility = VISIBLE
                text = it
            }
        }
        if (learnMoreLink.isNotEmpty()) {
            rootView.findViewById<TextView>(R.id.learn_more).apply {
                visibility = VISIBLE
                isLongClickable = false
                setOnClickListener {
                    feature?.onLearnMorePress(permissionRequestId, sessionId, learnMoreLink)
                    dismiss()
                }
            }
        }

        val positiveButton = rootView.findViewById<Button>(R.id.allow_button)
        val negativeButton = rootView.findViewById<Button>(R.id.deny_button)

        positiveButton.setOnClickListener {
            if (promptAbuserDetector.areDialogsBeingAbused()) {
                promptAbuserDetector.updateJSDialogAbusedState()
                logger.info("Button click happened before the security delay, click not handled")
            } else {
                feature?.onPositiveButtonPress(
                    permissionRequestId,
                    sessionId,
                    userSelectionCheckBox,
                ) {
                    if (!areSystemNotificationsEnabled()) showSettingsPrompt()
                }
                dismiss()
            }
        }

        if (positiveButtonBackgroundColor != DEFAULT_VALUE) {
            val backgroundTintList = AppCompatResources.getColorStateList(
                requireContext(),
                positiveButtonBackgroundColor,
            )
            positiveButton.backgroundTintList = backgroundTintList
        }

        if (positiveButtonTextColor != DEFAULT_VALUE) {
            val color = ContextCompat.getColor(requireContext(), positiveButtonTextColor)
            positiveButton.setTextColor(color)
        }

        negativeButton.setOnClickListener {
            feature?.onNegativeButtonPress(permissionRequestId, sessionId, userSelectionCheckBox)
            dismiss()
        }
        if (isNotificationRequest) {
            positiveButton.setText(R.string.mozac_feature_sitepermissions_always_allow)
            negativeButton.setText(R.string.mozac_feature_sitepermissions_never_allow)
        }
        negativeButtonText?.let {
            negativeButton.text = it
        }

        if (shouldShowDoNotAskAgainCheckBox) {
            showDoNotAskAgainCheckbox(
                containerView = rootView,
                checked = shouldPreselectDoNotAskAgainCheckBox,
                checkboxLabel = doNotAskAgainCheckBoxLabel.ifNullOrEmpty {
                    getString(R.string.mozac_feature_sitepermissions_do_not_ask_again_on_this_site2)
                },
            )
        }

        return rootView
    }

    private fun areSystemNotificationsEnabled() =
        NotificationManagerCompat.from(requireContext()).areNotificationsEnabled()

    private fun showSettingsPrompt() {
        with(requireContext()) {
            NotificationPermissionDialogFragment.newInstance(
                dialogTitleString = title,
                dialogMessageString = getString(
                    R.string.mozac_feature_sitepermissions_notification_permission_rationale_dialog_message,
                    appName,
                ),
                positiveButtonText = getString(
                    R.string.mozac_feature_sitepermissions_notification_permission_rationale_dialog_settings_label,
                ),
                negativeButtonText = getString(
                    R.string.mozac_feature_sitepermissions_notification_permission_rationale_dialog_dismiss_label,
                ),
                positiveButtonAction = {
                    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                        putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                        flags = FLAG_ACTIVITY_NEW_TASK
                    }
                    startActivity(intent)
                },
            ).showNow(
                parentFragmentManager,
                NotificationPermissionDialogFragment.FRAGMENT_TAG,
            )
        }
    }

    private fun showDoNotAskAgainCheckbox(
        containerView: View,
        checked: Boolean,
        checkboxLabel: String,
    ) {
        containerView.findViewById<CheckBox>(R.id.do_not_ask_again).apply {
            visibility = VISIBLE
            isChecked = checked
            text = checkboxLabel
            setOnCheckedChangeListener { _, isChecked ->
                userSelectionCheckBox = isChecked
            }
        }
    }

    companion object {
        fun newInstance(
            sessionId: String,
            title: String,
            titleIcon: Int,
            permissionRequestId: String = "",
            feature: SitePermissionsFeature,
            shouldShowDoNotAskAgainCheckBox: Boolean,
            shouldSelectDoNotAskAgainCheckBox: Boolean = false,
            doNotAskAgainCheckBoxLabel: String? = null,
            isNotificationRequest: Boolean = false,
            message: String? = null,
            negativeButtonText: String? = null,
            learnMoreLink: String? = null,
        ): SitePermissionsDialogFragment {
            val fragment = SitePermissionsDialogFragment()
            val arguments = fragment.arguments ?: Bundle()

            arguments.apply {
                putString(KEY_SESSION_ID, sessionId)
                putString(KEY_TITLE, title)
                putInt(KEY_TITLE_ICON, titleIcon)
                putString(KEY_MESSAGE, message)
                putString(KEY_NEGATIVE_BUTTON_TEXT, negativeButtonText)
                putString(KEY_PERMISSION_ID, permissionRequestId)
                putString(KEY_LEARN_MORE_LINK, learnMoreLink)

                putBoolean(KEY_IS_NOTIFICATION_REQUEST, isNotificationRequest)
                if (isNotificationRequest) {
                    putBoolean(KEY_SHOULD_SHOW_DO_NOT_ASK_AGAIN_CHECKBOX, false)
                    putBoolean(KEY_SHOULD_PRESELECT_DO_NOT_ASK_AGAIN_CHECKBOX, true)
                } else {
                    putBoolean(KEY_SHOULD_SHOW_DO_NOT_ASK_AGAIN_CHECKBOX, shouldShowDoNotAskAgainCheckBox)
                    putBoolean(KEY_SHOULD_PRESELECT_DO_NOT_ASK_AGAIN_CHECKBOX, shouldSelectDoNotAskAgainCheckBox)
                    putString(KEY_DO_NOT_ASK_AGAIN_CHECKBOX_LABEL, doNotAskAgainCheckBoxLabel)
                }

                feature.promptsStyling?.apply {
                    putInt(KEY_DIALOG_GRAVITY, gravity)
                    putBoolean(KEY_DIALOG_WIDTH_MATCH_PARENT, shouldWidthMatchParent)

                    positiveButtonBackgroundColor?.apply {
                        putInt(KEY_POSITIVE_BUTTON_BACKGROUND_COLOR, this)
                    }

                    positiveButtonTextColor?.apply {
                        putInt(KEY_POSITIVE_BUTTON_TEXT_COLOR, this)
                    }
                }
            }
            fragment.feature = feature
            fragment.arguments = arguments
            return fragment
        }

        // See https://searchfox.org/mozilla-central/rev/76cb3efe3b19e649bf675bb6ec5d4af8109b9771/toolkit/modules/PopupNotifications.sys.mjs#18
        private const val TIME_SHOWN_OFFSET_MILLIS = 500
    }
}
