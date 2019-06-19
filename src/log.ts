import {EOL} from 'os';
import {open, write, close} from 'fs';
import path from 'path';
import {tryFn} from './lang'
import {logDir, LogLevel} from './constants';

function processInput (path: string, text: string) {
  open(path, 'a', 666, function(err, id) {
    write(id, text, null, 'utf8', function(){
      close(id, function() {});
    });
  });
}

class Log {
  public location: string;
  public fileNamePrefix: string;
  public enabled: boolean = true;
  public enableConsoleLog: boolean = false;
  public logLevel: number = 0;

  // Used to queue lines of the log to be appended, so the file is written less frequently in chunks.
  private lines: string[] = [];

  constructor(
    location = logDir,
    fileNamePrefix = `session-${new Date().toISOString().split('T')[0]}`,
    enableConsoleLog = false
  ) {
    this.location = location;
    this.fileNamePrefix = fileNamePrefix;
    this.enableConsoleLog = enableConsoleLog;
  }

  public open() {
    if (!this.enabled) return;
    if (this.lines.length > 0) this.close();
  }

  public close() {
    if (!this.enabled) return;
    const configPath = path.resolve(this.location, `${this.fileNamePrefix}.log`);
    const {lines} = this;
    let output = '';

    for (let i = 0, len = lines.length; i < len; i++) {
      output += lines[i] + EOL;
    }

    processInput(configPath, output);

    this.lines = [];
  }

  private update(level: number, ...args: any[]) {
    if (this.enableConsoleLog) console.log(...args);

    tryFn(() => {
      let date = new Date();
      let isoString = date.toISOString();
      let argsString = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] instanceof Error) {
          argsString += `${args[i].message}${EOL}`;
          argsString += `${args[i].stack}${EOL}`;
          continue;
        }
        argsString += `${JSON.stringify(args[i])} `;
      }

      this.lines.push(
        `[${LogLevel[level]}] ${isoString}:    ${argsString.replace(/"/g, '').replace(/\\\\/g, '\\')}`
      );
    });
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
    if (!this.enabled) return;
    this.update(2, ...args);
  }
}

export default new Log();