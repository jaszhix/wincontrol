import {EOL} from 'os';
import {open, write, close, symlinkSync, unlinkSync, existsSync} from 'fs';
import path from 'path';
import {tryFn} from './lang'
import {logDir, LogLevel} from './constants';

const processInput = (
  path: string,
  text: string,
  cb?: (err: NodeJS.ErrnoException) => void
) => {
  open(path, 'a', 666, (err, id) => {
    write(id, text, null, 'utf8', () => {
      close(id, cb);
    });
  });
};

class Log {
  public location: string;
  public fileNamePrefix: string;
  public lastFileName: string;
  public enabled: boolean = true;
  public enableConsoleLog: boolean = false;
  public closing: boolean = false;
  public importantLinesQueued: boolean = false;
  public logLevel: number = 0;

  // Used to queue lines of the log to be appended, so the file is written less frequently in chunks.
  private lines: string[] = [];

  constructor(
    location = logDir,
    fileNamePrefix = 'session',
    enableConsoleLog = false
  ) {
    this.location = location;
    this.fileNamePrefix = fileNamePrefix;
    this.enableConsoleLog = enableConsoleLog || process.env.TEST_ENV != null;
  }

  get fileName() {
    return `${this.fileNamePrefix}-${new Date().toISOString().split('T')[0]}.log`;
  }

  private update(level: number, ...args: any[]) {
    if (this.enableConsoleLog) console.log(...args);

    tryFn(() => {
      let date = new Date();
      let isoString = date.toISOString();
      let argsString = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] instanceof Error) {
          argsString += `${args[i].stack}${EOL}`;
          continue;
        }
        argsString += `${args[i]} `;
      }

      this.lines.push(
        `[${LogLevel[level]}] ${isoString}:    ${argsString.replace(/"/g, '').replace(/\\\\/g, '\\')}`
      );
    });
  }

  public open() {
    if (!this.enabled) return;
    if (this.lines.length > 0) this.close();
  }

  public close() {
    if ((!this.enabled && !this.importantLinesQueued) || this.closing) return;

    let {fileName} = this;

    this.closing = true;
    this.importantLinesQueued = false;

    const configPath = path.resolve(this.location, fileName);

    // Symlink the current day's log file as current.log
    if (fileName !== this.lastFileName) {
      let currentLogPath = path.join(this.location, 'current.log');

      if (existsSync(currentLogPath)) unlinkSync(currentLogPath);

      symlinkSync(configPath, currentLogPath, 'file');
    }

    this.lastFileName = fileName;

    const {lines} = this;
    let output = '';

    for (let i = 0, len = lines.length; i < len; i++) {
      output += lines[i] + EOL;
    }

    processInput(configPath, output, () => this.closing = false);

    this.lines = [];
  }

  public important(...args: any[]) {
    this.update(0, ...args);
    this.importantLinesQueued = true;
  }

  public info(...args: any[]) {
    if (!this.enabled || this.logLevel > 0) return;

    this.update(0, ...args);
  }

  public warning(...args: any[]) {
    if (!this.enabled || this.logLevel > 1) return;

    this.update(1, ...args);
  }

  public error(...args: any[]) {
    this.update(2, ...args);
  }
}

export default new Log();