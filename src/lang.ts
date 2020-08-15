const findIndex = function(arr: any[], fn: Function): number {
  for (let i = 0, len = arr.length; i < len; i++) {
    if (fn(arr[i], i, arr)) {
      return i;
    }
  }

  return -1;
}

const find = function(arr: any[], fn: Function): any {
  for (let i = 0, len = arr.length; i < len; i++) {
    if (fn(arr[i], i, arr)) {
      return arr[i];
    }
  }

  return null;
}

const filter = function (arr: any[], fn: Function): any[] {
  let result = [];
  for (let i = 0, len = arr.length; i < len; i++) {
    if (fn(arr[i], i, arr)) {
      result.push(arr[i]);
    }
  }

  return result;
};

const map = function (arr: any[], fn: Function): any[] {
  if (arr == null) {
    return [];
  }

  let len = arr.length;
  let out = Array(len);

  for (let i = 0; i < len; i++) {
    out[i] = fn(arr[i], i, arr);
  }

  return out;
}

const merge = function(result: object, ...extenders: object[]): object {
  for (let i = 0, len = extenders.length; i < len; i++) {
    let keys = Object.keys(extenders[i]);
    for (let z = 0, len = keys.length; z < len; z++) {
      result[keys[z]] = extenders[i][keys[z]]
    }
  }
  return result;
}

const tryFn = function(fn: Function, errCb?: Function): any {
  try {
    return fn();
  } catch (e) {
    if (errCb) errCb(e);
  }
};

const mergeObjects = (obj1, obj2) => {
  const keys = Object.keys(obj1);
  const obj2Keys = Object.keys(obj2);
  const obj = {...obj1};

  for (let i = 0, len = obj2Keys.length; i < len; i++) {
    let key = obj2Keys[i];

    if (keys.indexOf(key) === -1) {
      keys.push(key);
    }
  }

  for (let i = 0, len = keys.length; i < len; i++) {
    let key = keys[i];

    if (obj2[key]) obj[key] = obj2[key];
  }

  return obj;
}

export {
  findIndex,
  find,
  filter,
  map,
  merge,
  tryFn,
  mergeObjects
};