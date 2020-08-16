declare interface AffinityConfiguration {
  name: string;
  ranges: Array<number[]>;
}

declare interface Conditional {
  condition: 'running' | 'fullscreenOverrideActive' | 'active';
  forProcesses?: string[];
  then: any; // 'disable' | ProcessConfiguration
  active: boolean;
}

declare interface ProcessState {
  isSuspended?: boolean;
  lastCPUTime?: string;
}

declare interface ProcessConfiguration {
  name?: string;
  cmd?: string[];
  affinity?: number | string;
  affinityName?: number;
  graph?: string;
  cpuPriority?: number;
  pagePriority?: number;
  ioPriority?: number;
  terminationDelay?: number;
  terminateOnce?: boolean;
  suspensionDelay?: number;
  resumeDelay?: number;
  processes?: string[];
  type?: 'standard' | 'fallback' | 'fullscreen';
  if?: Conditional[];
  state?: ProcessState;
}

declare interface AppConfiguration {
  interval: number;
  logging?: boolean;
  loggingInterval?: number;
  detailedLogging?: boolean;
  consoleLogging?: boolean;
  logLevel?: string;
  detectConfigChange?: boolean;
  ignoreProcesses?: string[];
  affinities: AffinityConfiguration[];
  profiles: ProcessConfiguration[];
  winControlAffinity?: string;
}

declare interface PowerShellProcessTime {
  Ticks: number;
  Days: number;
  Hours: number;
  Milliseconds: number;
  Minutes: number;
  Seconds: number;
  TotalDays: number;
  TotalHours: number;
  TotalMilliseconds: number;
  TotalMinutes: number;
  TotalSeconds: number;
}

declare interface PowerShellStartInfo {
  Verb: string;
  Arguments: string;
  CreateNoWindow: boolean;
  EnvironmentVariables: string;
  Environment: string;
  RedirectStandardInput: boolean;
  RedirectStandardOutput: boolean;
  RedirectStandardError: boolean;
  StandardErrorEncoding: string;
  StandardOutputEncoding: string;
  UseShellExecute: boolean;
  Verbs: string;
  UserName: string;
  Password: string;
  PasswordInClearText: string;
  Domain: string;
  LoadUserProfile: boolean;
  FileName: string;
  WorkingDirectory: string;
  ErrorDialog: boolean;
  ErrorDialogParentHandle: number;
  WindowStyle: number;
}

declare interface PowerShellModule {
  ModuleName: string;
  FileName: string;
  BaseAddress: number;
  ModuleMemorySize: number;
  EntryPointAddress: number;
  FileVersionInfo: string;
  Site: string;
  Container: string;
}

declare interface PowerShellSafeHandle {
  IsInvalid: boolean;
  IsClosed: boolean;
}

declare interface PowerShellProcess {
  BasePriority?: number;
  ExitCode?: number;
  HasExited?: boolean;
  ExitTime?: number;
  Handle?: number;
  SafeHandle?: PowerShellSafeHandle;
  HandleCount?: number;
  Id: number;
  MachineName?: string;
  MainWindowHandle?: number;
  MainWindowTitle?: string;
  MainModule?: PowerShellModule;
  MaxWorkingSet?: number;
  MinWorkingSet?: number;
  Modules?: string[];
  NonpagedSystemMemorySize?: number;
  NonpagedSystemMemorySize64?: number;
  PagedMemorySize?: number;
  PagedMemorySize64?: number;
  PagedSystemMemorySize?: number;
  PagedSystemMemorySize64?: number;
  PeakPagedMemorySize?: number;
  PeakPagedMemorySize64?: number;
  PeakWorkingSet?: number;
  PeakWorkingSet64?: number;
  PeakVirtualMemorySize?: number;
  PeakVirtualMemorySize64?: number;
  PriorityBoostEnabled?: boolean;
  PriorityClass?: number;
  PrivateMemorySize?: number;
  PrivateMemorySize64?: number;
  PrivilegedProcessorTime?: PowerShellProcessTime;
  ProcessName?: string;
  ProcessorAffinity: number;
  Responding?: boolean;
  SessionId?: number;
  StartInfo?: PowerShellStartInfo;
  StartTime?: string;
  SynchronizingObject?: null;
  Threads: string[];
  TotalProcessorTime?: PowerShellProcessTime;
  UserProcessorTime?: PowerShellProcessTime;
  VirtualMemorySize?: number;
  VirtualMemorySize64?: number;
  EnableRaisingEvents?: boolean;
  StandardInput?: null;
  StandardOutput?: null;
  StandardError?: null;
  WorkingSet?: number;
  WorkingSet64?: number;
  Site?: null;
  Container?: null;
  Name: string;
  SI?: number;
  Handles?: number;
  VM?: number;
  WS?: number;
  PM?: number;
  NPM?: number;
  Path?: string;
  Company?: string;
  CPU?: number;
  FileVersion?: string;
  ProductVersion?: string;
  Description?: string;
  Product?: string;
  __NounName?: string;
}

declare interface PSLogItem {
  psName: string;
  cmdAffected?: string;
  pids: number[];
}

declare interface LogItem extends ProcessConfiguration {
  name: string;
  isDisabled: boolean;
  isReplacedBy: string;
  conditionReason: string;
  affected: PSLogItem[];
  failed: PSLogItem[];
}

declare module 'process-list' {
  export interface ProcessSnapshot {
    name: string;
    pid: number;
    ppid: number;
    path: string;
    threads: number;
    owner: string;
    priority: number;
    cmdline: string;
    starttime: Date;
    vmem: string;
    pmem: string;
    cpu: number;
    utime: string;
    stime: string;
  }

  export interface SnapshotOptions {
    name: boolean;
    pid: boolean;
    ppid: boolean;
    path: boolean;
    threads: boolean;
    owner: boolean;
    priority: boolean;
    cmdline: boolean;
    starttime: boolean;
    vmem: boolean;
    pmem: boolean;
    cpu: boolean;
    utime: boolean;
    stime: boolean;
  }

  export function snapshot(...args: (keyof SnapshotOptions)[]): Promise<Partial<ProcessSnapshot>[]>;
}
