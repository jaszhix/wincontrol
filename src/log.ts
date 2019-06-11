import {EOL} from 'os';
import {open, write, close} from 'fs';
import path from 'path';
import {tryFn} from './lang'

function processInput (path: string, text: string) {
  open(path, 'a', 666, function(err, id) {
    write(id, text, null, 'utf8', function(){
      close(id, function() {});
    });
  });
}

enum LogLevel {
  info = 'INFO',
  warning = 'WARNING',
  error = 'ERROR'
}

class Log {
  public location: string;
  public fileNamePrefix: string;
  public enabled: boolean = true;
  public enableConsoleLog: boolean = false;

  // Used to queue lines of the log to be appended, so the file is written less frequently in chunks.
  private lines: string[] = [];

  constructor(
    location = './',
    fileNamePrefix = 'wincontrol',
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

  private update(level: LogLevel, ...args: any[]) {
    if (this.enableConsoleLog) console.log(...args);

    tryFn(() => {
      let date = new Date();
      let isoString = date.toISOString();
      let argsString = '';

      for (let i = 0; i < args.length; i++) {
        if (args[i] instanceof Error) {
          argsString += `${args[i].message}\n`;
          argsString += `${args[i].stack}\n`;
          continue;
        }
        argsString += `${JSON.stringify(args[i])} `;
      }

      this.lines.push(
        `[${level}] ${isoString}:    ${argsString.replace(/"/g, '').replace(/\\\\/g, '\\')}`
      );
    });
  }

  public info(...args: any[]) {
    if (!this.enabled) return;
    this.update(LogLevel.info, ...args);
  }

  public warning(...args: any[]) {
    if (!this.enabled) return;
    this.update(LogLevel.warning, ...args);
  }

  public error(...args: any[]) {
    if (!this.enabled) return;
    this.update(LogLevel.error, ...args);
  }
}

export default new Log();