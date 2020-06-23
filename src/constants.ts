import {homedir, cpus} from 'os';

const execOptions: any = {
  windowsHide: true,
  encoding: 'utf8',
  timeout: 0,
  maxBuffer: 4096*4096,
  // cwd: null,
  // env: null,
  stdio: ['ignore', 'pipe', 'ignore']
}

const assets = [
  './config.yaml',
  './assets/elevate.exe',
  './node_modules/ffi/build/Release/ffi_bindings.n',
  './node_modules/iconv/build/Release/iconv.n',
  './node_modules/ref/build/Release/binding.n',
  './node_modules/process-list/build/Release/processlist.n',
];

const isDevelopment = process.env.NODE_ENV === 'development';
const coreCount: number = cpus().length;
const pathSegments = process.argv[0].split('\\');
const currentDir = process.argv[0].split(`\\${pathSegments[pathSegments.length - 1]}`)[0];
const homeDir: string = homedir();
const appDir: string = `${homeDir}\\AppData\\Roaming\\WinControl`;
const logDir: string = `${appDir}\\logs`;
const appConfigYamlPath: string = `${appDir}\\config.yaml`;
const appConfigTaskXMLPath: string = `${appDir}\\import.xml`;

const ifConditionOptions = ['running', 'fullscreenOverrideActive', 'active'];

// Fullscreen detection needs more work, in the mean time, ignore the obvious cases.
const falsePositiveFullscreenApps = [
  'explorer', // occurs when the thumbnail menu in the taskbar is focused
  'windowsterminal' // when focused
];

enum cpuPriorityMap {
  idle = 64,
  belowNormal = 16384,
  normal = 32,
  aboveNormal = 32768,
  high = 128,
  realTime = 256,
  processModeBackgroundBegin = 1048576
};

enum PSPriorityMap {
  Idle = 64,
  BelowNormal = 16384,
  Normal = 32,
  AboveNormal = 32768,
  High = 128,
  RealTime = 256,
};

enum pagePriorityMap {
  idle = 1,
  low = 2,
  medium = 3,
  belowNormal = 4,
  normal = 5
};

enum ioPriorityMap {
  idle = 0,
  low,
  normal,
  high
}

const LogLevel  = [
  'INFO',
  'WARNING',
  'ERROR'
];

// Required by QueryFullProcessImageName
// https://docs.microsoft.com/en-us/windows/desktop/ProcThread/process-security-and-access-rights
const PROCESS_ALL_ACCESS = (0x000F0000/* L */ | 0x00100000/* L  */| 0xFFF);
const PROCESS_SET_INFORMATION = 0x0200;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_SUSPEND_RESUME = 0x0800;
const PROCESS_TERMINATE  = 0x0001;
const THREAD_QUERY_INFORMATION = 0x0040;
const THREAD_SET_INFORMATION = 0x0020;
const MONITOR_DEFAULTTOPRIMARY = 1;

enum GW {
  HWNDFIRST = 0,
  HWNDLAST,
  HWNDNEXT,
  HWNDPREV,
  OWNER,
  CHILD,
  ENABLEDPOPUP,
}

export {
  execOptions,
  assets,
  isDevelopment,
  coreCount,
  currentDir,
  homeDir,
  appDir,
  logDir,
  appConfigYamlPath,
  appConfigTaskXMLPath,
  ifConditionOptions,
  falsePositiveFullscreenApps,
  cpuPriorityMap,
  PSPriorityMap,
  pagePriorityMap,
  ioPriorityMap,
  LogLevel,
  PROCESS_ALL_ACCESS,
  PROCESS_SET_INFORMATION,
  PROCESS_QUERY_LIMITED_INFORMATION,
  PROCESS_SUSPEND_RESUME,
  PROCESS_TERMINATE,
  THREAD_QUERY_INFORMATION,
  THREAD_SET_INFORMATION,
  MONITOR_DEFAULTTOPRIMARY,
  GW,
};