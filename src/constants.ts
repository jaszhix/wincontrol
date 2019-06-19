import {homedir, cpus} from 'os';

const psCommand = `powershell "Get-Process `
  + `| Select-Object -Property 'Name','Id','StartTime','Threads','number','TotalProcessorTime' `
  + `| ConvertTo-Json -Compress"`;

const execOptions: any = {
  windowsHide: true,
  encoding: 'utf8',
  timeout: 0,
  maxBuffer: 4096*4096,
  // cwd: null,
  // env: null,
  stdio: ['ignore', 'pipe', 'ignore']
}

const coreCount: number = cpus().length;
const homeDir: string = homedir();
const appDir: string = `${homeDir}\\AppData\\Roaming\\WinControl`;
const logDir: string = `${appDir}\\logs`;
const appConfigYamlPath: string = `${appDir}\\config.yaml`;

enum cpuPriorityMap {
  idle = 64,
  belowNormal = 16384,
  normal = 32,
  aboveNormal = 32768,
  high = 128,
  realTime = 256,
  processModeBackgroundBegin = 1048576
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

export {
  psCommand,
  execOptions,
  coreCount,
  homeDir,
  appDir,
  logDir,
  appConfigYamlPath,
  cpuPriorityMap,
  pagePriorityMap,
  ioPriorityMap,
  LogLevel
};