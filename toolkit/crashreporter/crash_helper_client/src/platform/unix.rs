/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

use anyhow::Result;
use crash_helper_common::{
    ignore_eintr, BreakpadChar, BreakpadData, IPCChannel, IPCConnector, IPCListener,
};
use nix::{
    spawn::{posix_spawn, PosixSpawnAttr, PosixSpawnFileActions},
    sys::wait::waitpid,
    unistd::getpid,
};
use std::{
    env,
    ffi::{CStr, CString},
};

use crate::CrashHelperClient;

impl CrashHelperClient {
    pub(crate) fn new(
        program: *const BreakpadChar,
        breakpad_data: BreakpadData,
        minidump_path: *const BreakpadChar,
    ) -> Result<CrashHelperClient> {
        let channel = IPCChannel::new()?;
        let (listener, server_endpoint, client_endpoint) = channel.deconstruct();
        CrashHelperClient::spawn_crash_helper(
            program,
            breakpad_data,
            minidump_path,
            listener,
            server_endpoint,
        )?;

        Ok(CrashHelperClient {
            connector: client_endpoint,
            spawner_thread: None,
            helper_process: Some(()),
        })
    }

    fn spawn_crash_helper(
        program: *const BreakpadChar,
        breakpad_data: BreakpadData,
        minidump_path: *const BreakpadChar,
        listener: IPCListener,
        endpoint: IPCConnector,
    ) -> Result<()> {
        let parent_pid = getpid().to_string();
        let parent_pid_arg = unsafe { CString::from_vec_unchecked(parent_pid.into_bytes()) };
        let program = unsafe { CStr::from_ptr(program) };
        let breakpad_data_arg =
            unsafe { CString::from_vec_unchecked(breakpad_data.to_string().into_bytes()) };
        let minidump_path = unsafe { CStr::from_ptr(minidump_path) };
        let listener_arg = listener.serialize();
        let endpoint_arg = endpoint.serialize();

        let file_actions = PosixSpawnFileActions::init()?;
        let attr = PosixSpawnAttr::init()?;

        let env: Vec<CString> = env::vars()
            .map(|(key, value)| format!("{key}={value}"))
            .map(|string| CString::new(string).unwrap())
            .collect();

        let pid = posix_spawn(
            program,
            &file_actions,
            &attr,
            &[
                program,
                &parent_pid_arg,
                &breakpad_data_arg,
                minidump_path,
                &listener_arg,
                &endpoint_arg,
            ],
            env.as_slice(),
        )?;

        // The child should exit quickly after having forked off the
        // actual crash helper process, let's wait for it.
        ignore_eintr!(waitpid(pid, None))?;

        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    pub(crate) fn prepare_for_minidump(_pid: crash_helper_common::Pid) {
        // This is a no-op on platforms that don't need it
    }
}
