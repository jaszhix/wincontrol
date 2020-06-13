// Partially adapted from https://github.com/sindresorhus/active-win

/// <reference types="node" />

import {basename} from 'path';

import {Library, Callback} from 'ffi';
import ref from 'ref';
import Struct from 'ref-struct';
import wchar from 'ref-wchar';

import log from '../log';
import {getEnumKeyFromValue} from '../utils';
import {
  PROCESS_ALL_ACCESS,
  PROCESS_SET_INFORMATION,
  PROCESS_QUERY_LIMITED_INFORMATION,
  PROCESS_SUSPEND_RESUME,
  PROCESS_TERMINATE,
  MONITOR_DEFAULTTOPRIMARY,
} from '../constants';
import {NTStatus} from './status';

namespace NT {
  export enum PROCESS_INFORMATION_CLASS {
    ProcessBasicInformation = 0,
    ProcessQuotaLimits,
    ProcessIoCounters,
    ProcessVmCounters,
    ProcessTimes,
    ProcessBasePriority,
    ProcessRaisePriority,
    ProcessDebugPort,
    ProcessExceptionPort,
    ProcessAccessToken,
    ProcessLdtInformation,
    ProcessLdtSize,
    ProcessDefaultHardErrorMode,
    ProcessIoPortHandlers,
    ProcessPooledUsageAndLimits,
    ProcessWorkingSetWatch,
    ProcessUserModeIOPL,
    ProcessEnableAlignmentFaultFixup,
    ProcessPriorityClass,
    ProcessWx86Information,
    ProcessHandleCount,
    ProcessAffinityMask,
    ProcessPriorityBoost,
    ProcessDeviceMap,
    ProcessSessionInformation,
    ProcessForegroundInformation,
    ProcessWow64Information,
    ProcessImageFileName,
    ProcessLUIDDeviceMapsEnabled,
    ProcessBreakOnTermination,
    ProcessDebugObjectHandle,
    ProcessDebugFlags,
    ProcessHandleTracing,
    ProcessIoPriority,
    ProcessExecuteFlags,
    ProcessResourceManagement,
    ProcessCookie,
    ProcessImageInformation,
    ProcessCycleTime,
    ProcessPagePriority,
    ProcessInstrumentationCallback,
    ProcessThreadStackAllocation,
    ProcessWorkingSetWatchEx,
    ProcessImageFileNameWin32,
    ProcessImageFileMapping,
    ProcessAffinityUpdateMode,
    ProcessMemoryAllocationMode,
    MaxProcessInfoClass
  }

  export enum SecurityEntity {
    SeCreateTokenPrivilege = 1,
    SeAssignPrimaryTokenPrivilege = 2,
    SeLockMemoryPrivilege = 3,
    SeIncreaseQuotaPrivilege = 4,
    SeUnsolicitedInputPrivilege = 5,
    SeMachineAccountPrivilege = 6,
    SeTcbPrivilege = 7,
    SeSecurityPrivilege = 8,
    SeTakeOwnershipPrivilege = 9,
    SeLoadDriverPrivilege = 10,
    SeSystemProfilePrivilege = 11,
    SeSystemtimePrivilege = 12,
    SeProfileSingleProcessPrivilege = 13,
    SeIncreaseBasePriorityPrivilege = 14,
    SeCreatePagefilePrivilege = 15,
    SeCreatePermanentPrivilege = 16,
    SeBackupPrivilege = 17,
    SeRestorePrivilege = 18,
    SeShutdownPrivilege = 19,
    SeDebugPrivilege = 20,
    SeAuditPrivilege = 21,
    SeSystemEnvironmentPrivilege = 22,
    SeChangeNotifyPrivilege = 23,
    SeRemoteShutdownPrivilege = 24,
    SeUndockPrivilege = 25,
    SeSyncAgentPrivilege = 26,
    SeEnableDelegationPrivilege = 27,
    SeManageVolumePrivilege = 28,
    SeImpersonatePrivilege = 29,
    SeCreateGlobalPrivilege = 30,
    SeTrustedCredManAccessPrivilege = 31,
    SeRelabelPrivilege = 32,
    SeIncreaseWorkingSetPrivilege = 33,
    SeTimeZonePrivilege = 34,
    SeCreateSymbolicLinkPrivilege = 35,
  }

  export interface WindowRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    'ref.buffer'?: Buffer;
  }

  export interface MonitorInfo {
    cbSize: number;
    rcMonitor: WindowRect;
    rcWork: WindowRect;
    dwFlags: number;
  }

  export interface WindowInfo {
    title?: string;
    name?: string;
    pid: number;
    priorityClass?: number;
    visible?: boolean;
    isFullscreen: boolean;
    rect?: WindowRect;
  }

  export interface User32 {
    GetForegroundWindow(): Buffer;
    GetWindowTextW(handle: Buffer, b: Buffer, len: number): number;
    GetWindowTextLengthW(handle: Buffer): number;
    GetWindowThreadProcessId(handle: Buffer, processId: Buffer): number;
    GetWindowRect(handle: Buffer, rect: Buffer): number;
    IsWindowVisible(handle: Buffer): number;
    EnumWindows(cb: Buffer, lParam: Buffer): number;
    MonitorFromWindow(handle: Buffer, dwFlags: number): Buffer;
    GetMonitorInfoA(handle: Buffer, monitorInfo: Buffer): number;
  }

  export interface Kernel32 {
    OpenProcess(permission: number, bInheritHandle: boolean, processId: number): Buffer;
    CloseHandle(handle: Buffer): number;
    QueryFullProcessImageNameW(handle: Buffer, dwFlags: number, lpExeName: Buffer, lpdwSize: Buffer): number;
    GetPriorityClass(handle: Buffer): number;
    SetPriorityClass(handle: Buffer, dwPriorityClass: number): number;
    QueryProcessAffinityUpdateMode(handle: Buffer, lpdwFlags: number): number;
    SetProcessAffinityUpdateMode(handle: Buffer, dwFlags: number): number;
    GetProcessAffinityMask(handle: Buffer, processAffinity: Buffer, systemAffinity: Buffer): number;
    SetProcessAffinityMask(handle: Buffer, mask: number): number;
    GetProcessInformation(handle: Buffer, processInfoClass: number, processInfo: Buffer, processInfoSize: number): number;
    SetProcessInformation(handle: Buffer, processInfoClass: number, processInfo: Buffer, processInfoSize: number): number;
    TerminateProcess(handle: Buffer, processId: number): number;
    GetLastError(): number;
  }

  export interface Ntdll {
    NtQueryInformationProcess(handle: Buffer, processInfoClass: PROCESS_INFORMATION_CLASS, value: Buffer, size: number): NTStatus;
    NtSetInformationProcess(handle: Buffer, processInfoClass: PROCESS_INFORMATION_CLASS, value: Buffer, size: number): NTStatus;
    NtSuspendProcess(handle: Buffer): NTStatus;
    NtResumeProcess(handle: Buffer): NTStatus;
    RtlAdjustPrivilege(privilege: SecurityEntity, enable: boolean, currentThread: boolean, pbool: Buffer): NTStatus;
  }
}

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
}) as NT.User32;

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

  // https://docs.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocessinformation
  GetProcessInformation: ['int', ['pointer', 'int', MemoryPriorityInformationType, 'uint32']],

  // https://docs.microsoft.com/en-us/windows/desktop/api/processthreadsapi/nf-processthreadsapi-setprocessinformation
  SetProcessInformation: ['int', ['pointer', 'int', MemoryPriorityInformationType, 'uint32']],

  // https://docs.microsoft.com/en-us/windows/desktop/api/processthreadsapi/nf-processthreadsapi-terminateprocess
  TerminateProcess: ['int', ['pointer', 'uint32']],

  // https://docs.microsoft.com/en-us/windows/desktop/Debug/system-error-codes--0-499-
  // Always returns 0: https://github.com/node-ffi/node-ffi/issues/261
  GetLastError: ['uint32', []],
}) as NT.Kernel32;

const ntdll = new Library('ntdll.dll', {
  // Undocumented?
  NtQueryInformationProcess: ['ulong', ['pointer', 'int' /* enum */, 'int *', 'ulong']],
  NtSetInformationProcess: ['ulong', ['pointer', 'int' /* enum */, 'int *', 'ulong']],
  NtSuspendProcess: ['int', ['pointer']],
  NtResumeProcess: ['int', ['pointer']],
  RtlAdjustPrivilege: ['int', ['ulong', 'bool', 'bool', 'bool *']]
}) as NT.Ntdll;

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

const getWindowRect = function(windowHandle): NT.WindowRect {
  const ptr = allocateRect();

  user32.GetWindowRect(windowHandle, ptr);

  return ref.get(ptr);
}

const getWindowMonitorInfo = function(windowHandle): NT.MonitorInfo {
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

const getWindowInfo = function(windowHandle): NT.WindowInfo {
  const rect: NT.WindowRect = getWindowRect(windowHandle);
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
  const processId: number = ref.get(processIdBuffer);
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
    name: processName.toLowerCase(),
    pid: processId,
    priorityClass,
    visible: user32.IsWindowVisible(windowHandle) > 0,
    isFullscreen,
    rect,
  };
};

const getBasicWindowInfo = function(windowHandle): NT.WindowInfo {
  const rect: NT.WindowRect = getWindowRect(windowHandle);
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

const getActiveWindow = function(): NT.WindowInfo {
  return getBasicWindowInfo(user32.GetForegroundWindow());
};

const getPriorityClass = function(id: number): number {
  const handle = getHandleForProcessId(id);
  const priority = kernel32.GetPriorityClass(handle);

  kernel32.CloseHandle(handle);

  return priority;
};

const setPriorityClass = function(id: number, mask: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_INFORMATION);
  const status = kernel32.SetPriorityClass(handle, mask);

  kernel32.CloseHandle(handle);

  if (!status) {
    log.warning(`[setPriorityClass failure] PID: ${id}, LastError: ${kernel32.GetLastError()}`);
    return false;
  }

  return true;
};

const getProcessorAffinity = function(id: number): any[] {
  const handle = getHandleForProcessId(id);
  let processAffinity = ref.alloc('uint32');
  let systemAffinity = ref.alloc('uint32');

  if (!kernel32.GetProcessAffinityMask(handle, processAffinity, systemAffinity)) {
    log.warning(`[getProcessorAffinity failure] PID: ${id}, LastError: ${kernel32.GetLastError()}`);
    kernel32.CloseHandle(handle);
    return [null];
  }

  processAffinity = ref.get(processAffinity);
  systemAffinity = ref.get(systemAffinity);

  kernel32.CloseHandle(handle);

  return [processAffinity, systemAffinity];
};

const setProcessorAffinity = function(id: number, mask: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const maskBuffer = ref.alloc('ulonglong', mask);
  const status = kernel32.SetProcessAffinityMask(handle, ref.get(maskBuffer));

  kernel32.CloseHandle(handle);

  if (!status) {
    log.warning(`[setProcessorAffinity failure] PID: ${id}, LastError: ${kernel32.GetLastError()}`);
    return false;
  }

  return true;
};

const getPagePriority = function(id: number): number {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const pagePriorityInfo = new MemoryPriorityInformation();
  const ptr = ref.alloc(MemoryPriorityInformation, pagePriorityInfo);
  const status = kernel32.GetProcessInformation(handle, 0, ptr, 4);
  const priority = ref.get(ptr)['ref.buffer'].toJSON().data[0];

  kernel32.CloseHandle(handle);

  if (!status) {
    log.warning(`[getPagePriority failure] PID: ${id}, LastError: ${kernel32.GetLastError()}`);
    return 0;
  }

  return priority;
};

const setPagePriority = function(id: number, MemoryPriority: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const pagePriorityInfo = new MemoryPriorityInformation({MemoryPriority});
  const ptr = ref.alloc(MemoryPriorityInformation, pagePriorityInfo);
  const status = kernel32.SetProcessInformation(handle, 0, ptr, 4);

  kernel32.CloseHandle(handle);

  if (!status) {
    log.warning(`[setPagePriority failure] PID: ${id}, LastError: ${kernel32.GetLastError()}`);
    return false;
  }

  return true;
};

const terminateProcess = function(id: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_TERMINATE);
  const status = kernel32.TerminateProcess(handle, 0);

  kernel32.CloseHandle(handle);

  if (!status) {
    log.warning(`[terminateProcess failure] PID: ${id}, LastError: ${kernel32.GetLastError()}`);
    return false;
  }

  return true;
};

// Ntdll-based functions

const getIOPriority = function(id: number): number {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const ioPriorityValue = ref.alloc('int', 0);
  const status = ntdll.NtQueryInformationProcess(
    handle,
    NT.PROCESS_INFORMATION_CLASS.ProcessIoPriority,
    ioPriorityValue,
    ioPriorityValue.length
  );
  const priority = ref.get(ioPriorityValue);

  kernel32.CloseHandle(handle);

  if (status) {
    log.warning(`[getIOPriority failure] PID: ${id}, NT_STATUS: ${getEnumKeyFromValue(NTStatus, status)}, LastError: ${kernel32.GetLastError()}`);
    return 0;
  }

  return priority;
};

const setIOPriority = function(id: number, ioPriority: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_ALL_ACCESS);
  const ioPriorityValue = ref.alloc('int', ioPriority);
  const status = ntdll.NtSetInformationProcess(
    handle,
    NT.PROCESS_INFORMATION_CLASS.ProcessIoPriority,
    ioPriorityValue,
    ioPriorityValue.length
  );

  kernel32.CloseHandle(handle);

  if (status) {
    log.warning(`[setIOPriority failure] PID: ${id}, NT_STATUS: ${getEnumKeyFromValue(NTStatus, status)}, LastError: ${kernel32.GetLastError()}`);
    return false;
  }

  return true;
};

const suspendProcess = function(id: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_SUSPEND_RESUME);
  const status = ntdll.NtSuspendProcess(handle);

  kernel32.CloseHandle(handle);

  if (status) {
    log.warning(`[suspendProcess failure] PID: ${id}, NT_STATUS: ${getEnumKeyFromValue(NTStatus, status)}, LastError: ${kernel32.GetLastError()}`);
    return false;
  }

  return true;
};

const resumeProcess = function(id: number): boolean {
  const handle = getHandleForProcessId(id, PROCESS_SUSPEND_RESUME);
  const status = ntdll.NtResumeProcess(handle);

  kernel32.CloseHandle(handle);

  if (status) {
    log.warning(`[resumeProcess failure] PID: ${id}, NT_STATUS: ${getEnumKeyFromValue(NTStatus, status)}, LastError: ${kernel32.GetLastError()}`);
    return false;
  }

  return true;
};

const adjustPrivilege = function(privilege: NT.SecurityEntity, enable = true, currentThread = false): boolean {
  const pbool = ref.alloc('int', 0);
  const status = ntdll.RtlAdjustPrivilege(
    privilege,
    enable,
    currentThread,
    pbool
  );

  if (status) {
    log.warning(`[adjustPrivilege failure] PID: ${process.pid} NT_STATUS: ${getEnumKeyFromValue(NTStatus, status)}, LastError: ${kernel32.GetLastError()}`);
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
  getPagePriority,
  setPagePriority,
  getIOPriority,
  setIOPriority,
  terminateProcess,
  suspendProcess,
  resumeProcess,
  adjustPrivilege,
  NT,
};
