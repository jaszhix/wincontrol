// Partially adapted from https://github.com/sindresorhus/active-win

/// <reference types="node" />

import {basename} from 'path';

import {Library, Callback} from 'ffi';
import ref from 'ref';
import Struct from 'ref-struct';
import wchar from 'ref-wchar';

import log from './log';
import {
  PROCESS_ALL_ACCESS,
  PROCESS_SET_INFORMATION,
  PROCESS_QUERY_LIMITED_INFORMATION,
  MONITOR_DEFAULTTOPRIMARY,
  PROCESS_INFORMATION_CLASS,
} from './constants';

const MemoryPriorityInformation = Struct({
  MemoryPriority: 'uint'
});
const MemoryPriorityInformationType = ref.refType(MemoryPriorityInformation);

// TODO: Get the fullscreen window to prioritize games
// https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-getwindowrect
// https://docs.microsoft.com/en-us/previous-versions//dd162897(v=vs.85)
const Rect = Struct({
  left: 'long',
  top: 'long',
  right: 'long',
  bottom: 'long',
});
const RectType = ref.refType(Rect);

const MonitorInfo = Struct({
  cbSize: 'int',
  rcMonitor: Rect,
  rcWork: Rect,
  dwFlags: 'int'
});
const MonitorInfoType = ref.refType(MonitorInfo);

// Type information
// https://docs.microsoft.com/en-us/windows/desktop/winprog/windows-data-types

// Create ffi declarations for the C++ library and functions needed (User32.dll), using their "Unicode" (UTF-16) version
const user32 = new Library('User32.dll', {
  // https://msdn.microsoft.com/en-us/library/windows/desktop/ms633505(v=vs.85).aspx
  GetForegroundWindow: ['pointer', []],
  // https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-gettopwindow
  // GetTopWindow: ['pointer', ['pointer']],
  // https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-getwindow
  // GetWindow: ['pointer', ['pointer', 'uint']],
  // https://msdn.microsoft.com/en-us/library/windows/desktop/ms633520(v=vs.85).aspx
  GetWindowTextW: ['int', ['pointer', 'pointer', 'int']],
  // https://msdn.microsoft.com/en-us/library/windows/desktop/ms633521(v=vs.85).aspx
  GetWindowTextLengthW: ['int', ['pointer']],
  // https://msdn.microsoft.com/en-us/library/windows/desktop/ms633522(v=vs.85).aspx
  GetWindowThreadProcessId: ['uint32', ['pointer', 'uint32 *']],
  // https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-getwindowrect
  GetWindowRect: ['int', ['pointer', RectType]],

  // https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-iswindowvisible
  IsWindowVisible: ['int', ['pointer']],
  // https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-iswindowenabled
  // IsWindowEnabled: ['int', ['pointer']],

  // https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-enumwindows
  EnumWindows: ['int', ['pointer', 'pointer']],
  // https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-enumthreadwindows
  // EnumThreadWindows: ['int', ['pointer', 'pointer', 'ulong *']],

  // https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-monitorfromwindow
  MonitorFromWindow: ['pointer', ['pointer', 'int']],
  // https://docs.microsoft.com/en-us/windows/desktop/api/winuser/nf-winuser-getmonitorinfoa
  GetMonitorInfoA: ['int', ['pointer', MonitorInfoType]]
});

// Create ffi declarations for the C++ library and functions needed (Kernel32.dll), using their "Unicode" (UTF-16) version
const kernel32 = new Library('kernel32', {
  // https://msdn.microsoft.com/en-us/library/windows/desktop/ms684320(v=vs.85).aspx
  OpenProcess: ['pointer', ['uint32', 'int', 'uint32']],
  // https://msdn.microsoft.com/en-us/library/windows/desktop/ms724211(v=vs.85).aspx
  CloseHandle: ['int', ['pointer']],
  // https://msdn.microsoft.com/en-us/library/windows/desktop/ms684919(v=vs.85).aspx
  QueryFullProcessImageNameW: ['int', ['pointer', 'uint32', 'pointer', 'pointer']],

  // https://docs.microsoft.com/en-us/windows/desktop/api/processthreadsapi/nf-processthreadsapi-getpriorityclass
  GetPriorityClass: ['uint32', ['pointer']],
  // https://docs.microsoft.com/en-us/windows/desktop/api/processthreadsapi/nf-processthreadsapi-setpriorityclass
  SetPriorityClass: ['int', ['pointer', 'uint32']],

  // https://docs.microsoft.com/en-us/windows/desktop/api/processthreadsapi/nf-processthreadsapi-queryprocessaffinityupdatemode
  QueryProcessAffinityUpdateMode: ['int', ['pointer', 'uint32']],
  // https://docs.microsoft.com/en-us/windows/desktop/api/processthreadsapi/nf-processthreadsapi-setprocessaffinityupdatemode
  SetProcessAffinityUpdateMode: ['int', ['pointer', 'uint32']],

  // https://docs.microsoft.com/en-us/windows/desktop/Debug/system-error-codes--0-499-
  GetProcessAffinityMask: ['int', ['pointer', 'uint32 *', 'uint32 *']],
  // https://docs.microsoft.com/en-us/windows/desktop/api/winbase/nf-winbase-setprocessaffinitymask
  SetProcessAffinityMask: ['int', ['pointer', 'ulonglong']],

  // https://docs.microsoft.com/en-us/windows/desktop/api/processthreadsapi/nf-processthreadsapi-setprocessinformation
  SetProcessInformation: ['int', ['pointer', 'int', MemoryPriorityInformationType, 'uint32']],

  // https://docs.microsoft.com/en-us/windows/desktop/api/processthreadsapi/nf-processthreadsapi-terminateprocess
  TerminateProcess: ['int', ['pointer', 'uint32']],

  // https://docs.microsoft.com/en-us/windows/desktop/Debug/system-error-codes--0-499-
  GetLastError: ['uint32', []],
});

const ntdll = new Library('ntdll.dll', {
  // Undocumented?
  NtSetInformationProcess: ['ulong', ['pointer', 'int' /* enum */, 'int *', 'ulong']],
  NtSuspendProcess: ['int', ['pointer']],
  NtResumeProcess: ['int', ['pointer']]
});

const getHandleForProcessId = function(id, permission = PROCESS_QUERY_LIMITED_INFORMATION) {
  const processIdBuffer = ref.alloc('uint32', id);

  const processId = ref.get(processIdBuffer);

  return kernel32.OpenProcess(permission, false, processId);
};

const allocateRect = function() {
  const rect = new Rect();
  const ptr = ref.alloc(Rect, rect);

  return ptr;
}

const getWindowRect = function(windowHandle): WindowRect {
  const ptr = allocateRect();

  user32.GetWindowRect(windowHandle, ptr);

  return ref.get(ptr);
}

const getWindowMonitorInfo = function(windowHandle): any {
  const monitorPtr = user32.MonitorFromWindow(windowHandle, MONITOR_DEFAULTTOPRIMARY);
  const monitorInfo = new MonitorInfo({
    cbSize: 40,
    dwFlags: MONITOR_DEFAULTTOPRIMARY
  });
  const ptr = ref.alloc(MonitorInfo, monitorInfo);

  monitorInfo.cbSize = ptr.length;

  user32.GetMonitorInfoA(monitorPtr, ptr);

  return ref.get(ptr);
}

// Adapted from https://github.com/sindresorhus/active-win

const getWindowInfo = function(windowHandle): WindowInfo {
  const rect: WindowRect = getWindowRect(windowHandle);
  const monitorInfo = getWindowMonitorInfo(windowHandle);

  let isFullscreen: boolean = rect.right === monitorInfo.rcMonitor.right
    && rect.bottom === monitorInfo.rcMonitor.bottom;

  // Get the window text length in "characters", to create the buffer
  const windowTextLength = user32.GetWindowTextLengthW(windowHandle);
  // Allocate a buffer large enough to hold the window text as "Unicode" (UTF-16) characters (using ref-wchar)
  // This assumes using the "Basic Multilingual Plane" of Unicode, only 2 characters per Unicode code point
  // Include some extra bytes for possible null characters
  const windowTextBuffer = Buffer.alloc((windowTextLength * 2) + 4);
  // Write the window text to the buffer (it returns the text size, but is not used here)
  user32.GetWindowTextW(windowHandle, windowTextBuffer, windowTextLength + 2);
  // Remove trailing null characters
  const windowTextBufferClean = ref.reinterpretUntilZeros(windowTextBuffer, wchar.size);
  // The text as a JavaScript string
  const windowTitle = wchar.toString(windowTextBufferClean);

  // Allocate a buffer to store the process ID
  const processIdBuffer = ref.alloc('uint32');
  // Write the process ID creating the window to the buffer (it returns the thread ID, but is not used here)
  user32.GetWindowThreadProcessId(windowHandle, processIdBuffer);

  // Get the process ID as a number from the buffer
  const processId = ref.get(processIdBuffer);
  // Get a "handle" of the process
  const processHandle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, processId);

  // Set the path length to more than the Windows extended-length MAX_PATH length
  const pathLengthBytes = 66000;
  // Path length in "characters"
  const pathLengthChars = Math.floor(pathLengthBytes / 2);
  // Allocate a buffer to store the path of the process
  const processFileNameBuffer = Buffer.alloc(pathLengthBytes);
  // Create a buffer containing the allocated size for the path, as a buffer as it must be writable
  const processFileNameSizeBuffer = ref.alloc('uint32', pathLengthChars);
  // Write process file path to buffer
  kernel32.QueryFullProcessImageNameW(processHandle, 0, processFileNameBuffer, processFileNameSizeBuffer);
  // Remove null characters from buffer
  const processFileNameBufferClean = ref.reinterpretUntilZeros(processFileNameBuffer, wchar.size);
  // Get process file path as a string
  const processPath = wchar.toString(processFileNameBufferClean);
  // Get process file name from path
  const processName = basename(processPath);

  const priorityClass = kernel32.GetPriorityClass(processHandle);
  // Close the "handle" of the process
  kernel32.CloseHandle(processHandle);

  return {
    title: windowTitle,
    name: processName,
    pid: processId,
    priorityClass,
    visible: user32.IsWindowVisible(windowHandle) > 0,
    isFullscreen,
    rect,
  };
};

const getBasicWindowInfo = function(windowHandle): WindowInfo {
  const rect: WindowRect = getWindowRect(windowHandle);
  const monitorInfo = getWindowMonitorInfo(windowHandle);
  const isFullscreen: boolean = rect.right === monitorInfo.rcMonitor.right
    && rect.bottom === monitorInfo.rcMonitor.bottom;
  const processIdBuffer = ref.alloc('uint32');

  user32.GetWindowThreadProcessId(windowHandle, processIdBuffer);

  return {
    pid: ref.get(processIdBuffer),
    isFullscreen,
  };
};

const getWindows = function(cb): void {
  const windows = [];

  const enumWindowsCallback = Callback('void', ['pointer'], function(windowHandle) {
    const windowObject = getWindowInfo(windowHandle);
    const refWindow = windows.findIndex(function(window) {
      return window.pid === windowObject.pid;
    });

    if (refWindow === -1) windows.push(windowObject);
  });

  user32.EnumWindows(enumWindowsCallback, null);

  cb(windows);
};

const getActiveWindow = function(): WindowInfo {
  return getBasicWindowInfo(user32.GetForegroundWindow());
};

const getPriorityClass = function(id: number): number {
  const handle = getHandleForProcessId(id);
  const priority = kernel32.GetPriorityClass(handle);

  kernel32.CloseHandle(handle);

  return priority;
};

const getProcessorAffinity = function(id: number): any[] {
  const handle = getHandleForProcessId(id);
  let processAffinity = ref.alloc('uint32');
  let systemAffinity = ref.alloc('uint32');

  if (!kernel32.GetProcessAffinityMask(handle, processAffinity, systemAffinity)) {
    kernel32.CloseHandle(handle);
    return [null];
  }

  processAffinity = ref.get(processAffinity);
  systemAffinity = ref.get(systemAffinity);

  kernel32.CloseHandle(handle);

  return [processAffinity, systemAffinity];
};

const setPriorityClass = function(id: number, mask: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_INFORMATION);
  const status = kernel32.SetPriorityClass(handle, mask);

  kernel32.CloseHandle(handle);

  if (!status) {
    log.warning('Failed to set priority for process:', id);
    return false;
  }

  return true;
};


const setProcessorAffinity = function(id: number, mask: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const maskBuffer = ref.alloc('ulonglong', mask);
  const status = kernel32.SetProcessAffinityMask(handle, ref.get(maskBuffer));

  kernel32.CloseHandle(handle);

  if (!status) {
    log.warning('Failed to set affinity for process:', id, kernel32.GetLastError());
    return false;
  }

  return true;
};

const setPagePriority = function(id: number, MemoryPriority: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const pagePriorityInfo = new MemoryPriorityInformation({MemoryPriority});
  const ptr = ref.alloc(MemoryPriorityInformation, pagePriorityInfo);
  const status = kernel32.SetProcessInformation(handle, 0, ptr, 4);

  kernel32.CloseHandle(handle);

  if (!status) {
    log.warning('Failed to set page priority for process:', id, kernel32.GetLastError());
    return false;
  }

  return true;
};

const setIOPriority = function(id: number, ioPriority: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const ioPriorityValue = ref.alloc('int', ioPriority);
  const status = ntdll.NtSetInformationProcess(
    handle,
    PROCESS_INFORMATION_CLASS.ProcessIoPriority,
    ioPriorityValue,
    ioPriorityValue.length
  );

  kernel32.CloseHandle(handle);

  if (status) {
    log.warning('Failed to set I/O priority for process:', id, kernel32.GetLastError(), status);
    return false;
  }

  return true;
};

const terminateProcess = function(id: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const status = kernel32.TerminateProcess(handle, 0);

  kernel32.CloseHandle(handle);

  if (!status) {
    log.warning('Failed to terminate process:', id, kernel32.GetLastError());
    return false;
  }

  return true;
};

const suspendProcess = function(id: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const status = ntdll.NtSuspendProcess(handle);

  kernel32.CloseHandle(handle);

  if (status) {
    log.warning('Failed to suspend process:', id, kernel32.GetLastError(), status);
    return false;
  }

  return true;
};

const resumeProcess = function(id: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const status = ntdll.NtResumeProcess(handle);

  kernel32.CloseHandle(handle);

  if (status) {
    log.warning('Failed to resume process:', id, kernel32.GetLastError(), status);
    return false;
  }

  return true;
};

export {
  getActiveWindow,
  getWindows,
  getPriorityClass,
  getProcessorAffinity,
  setPriorityClass,
  setProcessorAffinity,
  setPagePriority,
  setIOPriority,
  terminateProcess,
  suspendProcess,
  resumeProcess,
};
