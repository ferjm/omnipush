/**
 * Rough node script to push local mozilla-central JS changes to a Firefox OS
 * device. 
 */

var sys = require('sys'),
    exec = require('child_process').exec,
    path = require('path'),
    spawn = require('child_process').spawn,
    fs = require('fs');

//TODO: get m-c from envvar
var mc = '/ssd/dev/mozilla/mozilla-inbound';
var preprocessorPy = mc + '/js/src/config/Preprocessor.py';
var omniDir;
var filesToPush = [];

function clasifyFiles(files, callback) {
  var stdin = process.stdin, stdout = process.stdout;
  stdin.resume();

  var file = path.normalize(files[files.length - 1]).trim();
  var leaf = file.slice(file.lastIndexOf('/') + 1);
  stdout.write('Is ' + file + ' a component(c) or a module(m)? ');

  stdin.once('data', function(data) {
    data = data.toString().trim();

    if (data == 'c' || data == 'm') {
      filesToPush.push({
        path: file,
        name: leaf,
        type: data
      });
      files.pop();
      if (!files.length) {
        callback();
      } else {
        clasifyFiles(files, callback);
      }
    } else {
      stdout.write('Enter c or m, please\n');
      clasifyFiles(files, callback);
    }
  });
}

function pullAndUnzipOmniJa(callback) {
  try {
    process.chdir('/tmp');
  } catch (err) {
    console.log('chdir: ' + err);
    process.exit();
  }

  try {
    omniDir = 'omni' + Date.now();
    fs.mkdirSync(omniDir, 0755);
    console.log('Created ' + omniDir);
  } catch (err) {
    console.log('mkdir: ' + err);
    process.exit();
  }

  try {
    process.chdir(omniDir);
  } catch (err) {
    console.log('chdir: ' + err);
    process.exit();
  }

  console.log('Getting omni.ja...');
  exec('adb pull /system/b2g/omni.ja ', function(error) {
    if (error) {
      console.log(error);
      process.exit();
    }

    console.log('Unzip omni.ja...');
    var unzip = spawn('unzip', ['omni.ja']);
    unzip.stderr.on('data', function (data) {});
    unzip.on('close', function() {
      console.log('Successfully unzipped');
      callback(omniDir);
    });
  });
}

function adbShell(command, callback) {
  console.log(command);
  exec('adb shell ' + command, function(error) {
    if (error) {
      console.log(error);
      process.exit();
    }
    callback();
  });
}

function adbRemount(callback) {
  exec('adb remount', function(error) {
    if (error) {
      console.log(error);
      process.exit();
    }
    callback();
  });
}

function zipAndPushOmniJa(callback) {
  console.log('Zipping omni.ja');
  fs.unlinkSync('/tmp/' + omniDir + '/omni.ja');
  var zip = spawn('zip', ['-r', 'omni.ja', '.']);
  zip.stderr.on('data', function (data) {});
  zip.on('close', function() {
    console.log('Successfully zipped');
    console.log('Pushing omni.ja...');
    adbRemount(function() {
      exec('adb push omni.ja /system/b2g/', function(error) {
        if (error) {
          console.log(error);
          process.exit();
        }

        console.log('Chicken ready!');
        callback();
      });
    });
  });
}

function modifyFiles(callback) {
  var file = filesToPush.pop();
  var dest = (file.type == 'c') ? 'components/' : 'modules/';
  dest += file.name;
  var destTmp = dest + '.toprocess';
  var orig = mc + '/' + file.path;
  console.log('Copy ' + orig + ' in ' + destTmp);
  fs.createReadStream(orig).pipe(fs.createWriteStream(destTmp));

  console.log('Preprocessing ' + destTmp);

  // TODO: get a list of defines from json file
  var preprocessor = spawn('python', [preprocessorPy, '-o', dest, '-D',
                                      'MOZ_WIDGET_GONK', destTmp]);
  preprocessor.on('close', function() {
    fs.unlinkSync('/tmp/' + omniDir + '/' + destTmp);
    if (!filesToPush.length) {
      callback();
      return;
    }
    modifyFiles(callback);
  });
}

//---

try {
  process.chdir(mc);
}
catch (err) {
  console.log('chdir: ' + err);
  process.exit();
}

exec('hg status', function (error, stdout, stderr) {
  if (error !== null) {
    console.log(error);
    process.exit();
  }

  var files = stdout.split('M ');
  var last = files[files.length - 1].split('?');
  files[files.length - 1] = last[0];
  files.shift();

  sys.print(stdout);

  if (!files.length) {
    console.log('No changes found');
    process.exit();
  }

  clasifyFiles(files, function() {
    pullAndUnzipOmniJa(function() {
      modifyFiles(function() {
        adbShell('stop b2g', function() {
          zipAndPushOmniJa(function() {
            adbShell('start b2g', process.exit);
          });
        });
      });
    });
  });
});

