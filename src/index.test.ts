
import {parseProfilesConfig} from './index';

import {readYamlFile} from './utils';

test('parseProfilesConfig: can parse profiles', async (done) => {
  const appConfig = await readYamlFile('./test/config.yaml');
  const parser = jest.fn(parseProfilesConfig);

  parser(appConfig);

  expect(parser).toHaveBeenCalledTimes(1);

  expect(appConfig.profiles[0].name).toBe('servicesPriorityOnlyLow');
  expect(appConfig.profiles[0].affinity).toBe(16383);
  expect(appConfig.profiles[0].cpuPriority).toBe(16384);
  expect(appConfig.profiles[0].pagePriority).toBe(5);
  expect(appConfig.profiles[0].ioPriority).toBe(1);
  expect(appConfig.profiles[0].graph).toBe(
    '[ 0| 1| 2| 3| 4| 5| 6| 7| 8| 9|10|11|12|13|--|--|--|--|--|--|--|--|--|--|--|--|--|--]'
  );

  done();
});
