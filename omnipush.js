/**
 * Rough node script to push local mozilla-central JS changes to a Firefox OS
 * device.
 */

'use strict';

var sys = require('sys'),
    exec = require('child_process').exec,
    path = require('path'),
    spawn = require('child_process').spawn,
    fs = require('fs');

var geckoPath = process.env.GECKO_PATH;
var preprocessorPy = geckoPath + '/js/src/config/Preprocessor.py';
var omniDir;
var filesToPush = [];
// TODO get a list of defines to override the default ones.
var defaultDefines = ['-D', 'MOZ_B2G',
                      '-D', 'MOZ_WIDGET_GONK',
                      '-D', 'MOZ_CAPTIVEDETECT',
                      '-D', 'MOZ_B2G_RIL',
                      '-D', 'MOZ_B2G_BT'];

function onError(err) {
  console.log(err);
  process.exit(1);
}

function clasifyFiles(files, callback) {
  if (!files.length) return callback();

  var file = path.normalize(files.pop()).trim();
  var name = path.basename(file);
  var dest;
  if (fs.existsSync('components/' + name)) {
    dest = 'components/' + name;
  } else if(fs.existsSync('modules/' + name)) {
    dest = 'modules/' + name;
  } else if(fs.existsSync('chrome/chrome/content/' + name)) {
    dest = 'chrome/chrome/content/' + name;
  } else {
    onError('Cannot find type for ' + name);
  }

  filesToPush.push({
    orig: file,
    dest: dest
  });

  clasifyFiles(files, callback);
}

function pullAndUnzipOmniJa(callback) {
  omniDir = '/tmp/omni' + Date.now();
  fs.mkdir(omniDir, parseInt('0755', 8), function(err) {
    if (err) {
      console.log('mkdir: ' + err);
      process.exit(1);
    }

    try {
      process.chdir(omniDir);
    } catch (err) {
      console.log('-chdir: ' + omniDir + ' ' + err);
      process.exit(1);
    }

    console.log('Getting omni.ja...');
    exec('adb pull /system/b2g/omni.ja ', function(error) {
      if (error) {
        console.log(error);
        process.exit(1);
      }

      console.log('Unzip omni.ja...');
      var unzip = spawn('unzip', ['omni.ja']);
      unzip.stderr.on('data', function(data) {});
      unzip.on('close', function() {
        console.log('Successfully unzipped');
        callback(omniDir);
      });
    });
  });
}

function adbShell(command, callback) {
  console.log(command);
  exec('adb shell ' + command, callback);
}

function adbRemount(callback) {
  exec('adb remount', callback);
}

function zipAndPushOmniJa(callback) {
  console.log('Zipping omni.ja');
  fs.unlinkSync(omniDir + '/omni.ja');
  var zip = spawn('zip', ['-r', 'omni.ja', '.']);
  zip.stderr.on('data', function(data) {});
  zip.on('close', function() {
    console.log('Successfully zipped');
    console.log('Pushing omni.ja...');
    adbRemount(function(err) {
      if (err) return onError(err);
      exec('adb push omni.ja /system/b2g/', function(err) {
        if (err) return onError(err);

        console.log('Chicken ready!');
        callback();
      });
    });
  });
}

function modifyFiles(callback) {
  var file = filesToPush.pop();
  var destTmp = file.dest + '.toprocess';
  var orig = geckoPath + '/' + file.orig;
  console.log('Copy ' + orig + ' in ' + destTmp);
  fs.createReadStream(orig).pipe(fs.createWriteStream(destTmp));

  console.log('Preprocessing ' + destTmp);

  // TODO: get a list of defines from json file
  var args = [preprocessorPy, '-o', file.dest];
  args = args.concat(defaultDefines);
  args.push(destTmp);
  var preprocessor = spawn('python', args);
  preprocessor.on('close', function() {
    fs.unlinkSync(omniDir + '/' + destTmp);
    if (!filesToPush.length) {
      callback();
      return;
    }
    modifyFiles(callback);
  });
}

//---

if (!geckoPath) onError('No GECKO_PATH found');

try {
  process.chdir(geckoPath);
}
catch (err) {
  console.log('chdir: ' + err);
  process.exit();
}

exec('hg status', function(error, stdout, stderr) {
  if (error !== null) {
    console.log(error);
    process.exit();
  }

  var files = stdout.split('M ');
  var last = files[files.length - 1].split('?');
  files[files.length - 1] = last[0];
  files.shift();

  if (!files.length) {
    console.log('No changes found');
    process.exit();
  }

  pullAndUnzipOmniJa(function() {
    clasifyFiles(files, function() {
      modifyFiles(function() {
        adbShell('stop b2g', function(err) {
          if (err) return onError(err);
          zipAndPushOmniJa(function() {
            adbShell('start b2g', process.exit);
          });
        });
      });
    });
  });
});

