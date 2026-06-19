/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package mozilla.components.support.utils

/**
 * Allows forwarding [android.app.Activity.onEnterAnimationComplete] to other classes
 * (e.g. fragments) that want to participate in handling it.
 */
interface OnEnterAnimationCompleteListener {
    /**
     * Called when the Activity's entering animation has completed.
     */
    fun onEnterAnimationComplete()
}
