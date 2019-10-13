import {userInfo, hostname} from 'os';
import {resolve} from 'path';
import fs from 'fs-extra';
import {exc, getUserSID} from './utils';
import log from './log';

const hostName = hostname();
const {username} = userInfo();
const identity = `${hostName}\\${username}`;
const currentPath = resolve('.');
const taskName = 'Start WinControl';

const createTaskShedulerTemplate = (sid): string =>
`<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Date>2019-05-05T21:57:29.0269835</Date>
    <Author>${identity}</Author>
    <URI>\\${taskName}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${identity}</UserId>
      <Delay>PT1M</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${sid}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>true</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>true</StopIfGoingOnBatteries>
    <AllowHardTerminate>false</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>true</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <DisallowStartOnRemoteAppSession>false</DisallowStartOnRemoteAppSession>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${currentPath}\\start.vbs</Command>
      <WorkingDirectory>${currentPath}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;

const installTaskSchedulerTemplate = async (path: string) => {
  let template = createTaskShedulerTemplate(await getUserSID(username));

  await fs.writeFile(path, template);
  await exc(`schtasks /create /xml "${path}" /tn "\\${taskName}"`);

  log.info('Installed scheduled task for starting WinControl on user login.');
};

export {installTaskSchedulerTemplate};
