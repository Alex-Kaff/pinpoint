/* Chrome loads the background as a service worker, which takes a single entry
   file rather than Firefox's list of scripts. Same files, same order. */
importScripts('lib/browser-shim.js', 'lib/common.js', 'background.js');
