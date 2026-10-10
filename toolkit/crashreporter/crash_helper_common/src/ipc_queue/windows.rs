/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

use std::{
    collections::HashMap,
    mem::MaybeUninit,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle},
    ptr::null_mut,
    rc::Rc,
};
use windows_sys::Win32::{
    Foundation::{ERROR_BROKEN_PIPE, FALSE, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Threading::INFINITE,
        IO::{CreateIoCompletionPort, GetQueuedCompletionStatus, OVERLAPPED},
    },
};

use crate::{
    errors::IPCError,
    ipc_queue::IPCQueueError,
    messages::Header,
    platform::{
        windows::{get_last_error, OverlappedOperation},
        PlatformError,
    },
    IPCConnector, IPCConnectorKey, IPCEvent, IPCListener,
};

const CONCURRENT_THREADS: u32 = 1;

struct IPCQueueElement {
    connector: Rc<IPCConnector>,
    operation: Option<OverlappedOperation>,
}

pub struct IPCQueue {
    connectors: HashMap<IPCConnectorKey, IPCQueueElement>,
    listener: IPCListener,
    listen_operation: Option<OverlappedOperation>,
    port: OwnedHandle,
}

impl IPCQueue {
    pub fn new(listener: IPCListener) -> Result<IPCQueue, IPCQueueError> {
        let listener_port = listener.as_raw();

        // Create a new completion port that allows only one active thread.
        let port = unsafe {
            CreateIoCompletionPort(
                /* FileHandle */ INVALID_HANDLE_VALUE,
                /* ExistingCompletionPort */ 0,
                /* CompletionKey */ 0,
                CONCURRENT_THREADS,
            ) as RawHandle
        };

        if port.is_null() {
            return Err(IPCQueueError::CreationFailure(get_last_error()));
        }

        let mut queue = IPCQueue {
            connectors: HashMap::with_capacity(10),
            listener,
            listen_operation: None,
            port: unsafe { OwnedHandle::from_raw_handle(port) },
        };

        queue.add_handle(listener_port)?;

        Ok(queue)
    }

    pub fn add_connector(&mut self, connector: &Rc<IPCConnector>) -> Result<(), IPCQueueError> {
        self.add_handle(connector.as_raw())?;
        self.insert_connector(connector);
        Ok(())
    }

    fn insert_connector(&mut self, connector: &Rc<IPCConnector>) {
        let res = self.connectors.insert(
            connector.key(),
            IPCQueueElement {
                connector: connector.clone(),
                operation: None,
            },
        );
        debug_assert!(res.is_none());
    }

    fn add_handle(&mut self, handle: HANDLE) -> Result<(), IPCQueueError> {
        let port = unsafe {
            CreateIoCompletionPort(
                handle,
                self.port.as_raw_handle() as HANDLE,
                // Use the connector's handle as the events' key
                handle as usize,
                CONCURRENT_THREADS,
            ) as RawHandle
        };

        if port.is_null() {
            return Err(IPCQueueError::RegistrationFailure(get_last_error()));
        }

        Ok(())
    }

    pub fn wait_for_events(&mut self) -> Result<Vec<IPCEvent>, IPCQueueError> {
        let mut events = Vec::with_capacity(1);

        for element in self.connectors.values_mut() {
            if element.operation.is_none() {
                match element.connector.sched_recv_header() {
                    Ok(operation) => element.operation = Some(operation),
                    Err(_error @ IPCError::ReceptionFailure(PlatformError::BrokenPipe)) => {
                        events.push(IPCEvent::Disconnect(element.connector.key()));
                    }
                    Err(error) => return Err(IPCQueueError::from(error)),
                }
            }
        }

        for event in &events {
            if let IPCEvent::Disconnect(key) = event {
                self.connectors.remove(key);
            }
        }

        if self.connectors.len() == 0 {
            // The last client disconnected.
            return Ok(events);
        }

        if self.listen_operation.is_none() {
            self.listen_operation = Some(self.listener.sched_listen()?);
        }

        let mut number_of_bytes_transferred = MaybeUninit::<u32>::uninit();
        let mut completion_key = MaybeUninit::<IPCConnectorKey>::uninit();
        let mut overlapped = MaybeUninit::<*mut OVERLAPPED>::uninit();

        let res = unsafe {
            GetQueuedCompletionStatus(
                self.port.as_raw_handle() as HANDLE,
                number_of_bytes_transferred.as_mut_ptr(),
                completion_key.as_mut_ptr(),
                overlapped.as_mut_ptr(),
                INFINITE,
            )
        };

        // SAFETY: `overlapped` will always be populated by
        // `GetQueueCompletionStatus()` so it's safe to assume initialization.
        let overlapped = unsafe { overlapped.assume_init() };

        if res == FALSE {
            let err = get_last_error();

            // If `overlapped` is non-null then the completion packet contained
            // the result of a failed I/O operation. We only handle failures
            // caused by a broken pipes, all others are considered fatal.
            if !overlapped.is_null() && (err == ERROR_BROKEN_PIPE) {
                // SAFETY: `overlapped` was non-null, so `completion_key` has
                // also been populated by `GetQueuedCompletionStatus()`.
                let completion_key = unsafe { completion_key.assume_init() };
                let element = self.connectors.remove(&completion_key);
                debug_assert!(element.is_some(), "Completion on missing connector");
                events.push(IPCEvent::Disconnect(completion_key));
            } else {
                return Err(IPCQueueError::WaitError(err));
            }
        } else {
            // SAFETY: `GetQueueCompletionStatus()` successfully retrieved a
            // completed I/O operation, all parameters have been populated.
            let (number_of_bytes_transferred, completion_key) = unsafe {
                (
                    number_of_bytes_transferred.assume_init(),
                    completion_key.assume_init(),
                )
            };

            if self.is_listener(completion_key) {
                events.push(self.handle_listener_event(number_of_bytes_transferred)?);
            } else {
                let element = self
                    .connectors
                    .get_mut(&completion_key)
                    .expect("Event did not match a known connector");
                let operation = element
                    .operation
                    .take()
                    .expect("No pending receive operation");
                let buffer = operation.collect_recv(number_of_bytes_transferred as usize);
                let header = Header::decode(buffer)?;
                let payload = element.connector.recv(header.size);
                match payload {
                    Ok(payload) => {
                        events.push(IPCEvent::Message(
                            completion_key,
                            header,
                            payload.0,
                            payload.1,
                        ));
                    }
                    Err(_error @ IPCError::ReceptionFailure(PlatformError::BrokenPipe)) => {
                        // This connector will generate a disconnection event
                        // when `wait_for_events()` is called again. Do nothing
                        // for the time being.
                    }
                    Err(error) => return Err(IPCQueueError::from(error)),
                }
            }
        }

        Ok(events)
    }

    fn is_listener(&self, completion_key: IPCConnectorKey) -> bool {
        self.listener.as_raw() as IPCConnectorKey == completion_key
    }

    fn handle_listener_event(
        &mut self,
        number_of_bytes_transferred: u32,
    ) -> Result<IPCEvent, IPCQueueError> {
        // A connection event will have 0 bytes transferred
        if number_of_bytes_transferred != 0 {
            return Err(IPCQueueError::UnexpectedEvent(
                "Non-zero transfer received on the listener",
            ));
        }

        let operation = self.listen_operation.take();
        if let Some(operation) = operation {
            operation.accept().map_err(|_e| IPCQueueError::RegistrationFailure(0))?;
        }
        let connector = Rc::new(self.listener.replace_pipe()?);
        self.insert_connector(&connector);

        // After the pipe is connected the listener handle will have been
        // replaced with a new one, so associate the new handle with the
        // completion queue.
        self.add_handle(self.listener.as_raw())?;

        Ok(IPCEvent::Connect(connector))
    }
}

impl Drop for IPCQueue {
    fn drop(&mut self) {
        // Cancel all the pending operations.
        for element in self.connectors.values_mut() {
            if let Some(operation) = &mut element.operation {
                if !operation.cancel() {
                    operation.leak();
                }
            }
        }

        if let Some(operation) = &mut self.listen_operation {
            if !operation.cancel() {
                operation.leak();
            }
        }

        // Drain the queue, once no more events are left we can safely drop it.
        loop {
            let mut number_of_bytes_transferred: u32 = 0;
            let mut completion_key: IPCConnectorKey = 0;
            let mut overlapped: *mut OVERLAPPED = null_mut();

            let res = unsafe {
                GetQueuedCompletionStatus(
                    self.port.as_raw_handle() as HANDLE,
                    &mut number_of_bytes_transferred,
                    &mut completion_key,
                    &mut overlapped,
                    0,
                )
            };

            // TODO: Check that we got enough completion events?

            if res == FALSE && overlapped.is_null() {
                // TODO: Maybe check the error and report odd ones?
                break;
            }
        }
    }
}
