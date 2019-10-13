declare interface AffinityConfiguration {
  name: string;
  ranges: Array<number[]>;
}

declare interface Conditional {
  condition: 'running' | 'fullscreenOverrideActive';
  forProcesses?: string[];
  then: any; // 'disable' | ProcessConfiguration
}

declare interface ProcessConfiguration {
  name?: string;
  cmd?: string[];
  affinity?: number;
  affinityName?: number;
  graph?: string;
  cpuPriority?: number;
  pagePriority?: number;
  ioPriority?: number;
  terminationDelay?: number;
  suspensionDelay?: number;
  resumeDelay?: number;
  processes?: string[];
  default?: boolean;
  if?: Conditional;
}

declare interface AppConfiguration {
  interval: number;
  logging?: boolean;
  detailedLogging?: boolean;
  consoleLogging?: boolean;
  logLevel?: string;
  detectConfigChange?: boolean;
  fullscreenPriority?: boolean;
  affinities: AffinityConfiguration[];
  profiles: ProcessConfiguration[];
}

declare interface WindowRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  'ref.buffer'?: Buffer;
}

declare interface WindowInfo {
  title?: string;
  name?: string;
  pid: number;
  priorityClass?: number;
  visible?: boolean;
  isFullscreen: boolean;
  rect?: WindowRect;
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