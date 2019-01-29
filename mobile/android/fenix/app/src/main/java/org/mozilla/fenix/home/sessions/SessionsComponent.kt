/* This Source Code Form is subject to the terms of the Mozilla Public
   License, v. 2.0. If a copy of the MPL was not distributed with this
   file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.fenix.home.sessions

import android.annotation.SuppressLint
import android.view.ViewGroup
import mozilla.components.browser.session.Session
import mozilla.components.support.base.log.logger.Logger
import org.mozilla.fenix.mvi.Action
import org.mozilla.fenix.mvi.ActionBusFactory
import org.mozilla.fenix.mvi.Change
import org.mozilla.fenix.mvi.UIComponent
import org.mozilla.fenix.mvi.ViewState

class SessionsComponent(
    private val container: ViewGroup,
    override val bus: ActionBusFactory,
    override var initialState: SessionsState = SessionsState(emptyList())
) :
    UIComponent<SessionsState, SessionsAction, SessionsChange>(bus) {

    override val reducer: (SessionsState, SessionsChange) -> SessionsState = { state, change ->
        when (change) {
            is SessionsChange.SessionsChanged -> state // copy state with changes here
        }
    }

    override fun initView() = SessionsUIView(container, bus)

    init {
        setup()
    }

    @SuppressLint("CheckResult")
    fun setup(): SessionsComponent {
        render(reducer)
        getUserInteractionEvents<SessionsAction>()
            .subscribe {
                Logger("SessionsComponent").debug(it.toString())
            }
        return this
    }
}

data class SessionsState(val sessions: List<Session>) : ViewState

sealed class SessionsAction : Action {
    object Select : SessionsAction()
}

sealed class SessionsChange : Change {
    object SessionsChanged : SessionsChange()
}
