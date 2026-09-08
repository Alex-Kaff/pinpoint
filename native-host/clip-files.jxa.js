/*
  Puts one or more files on the macOS clipboard as real file references
  (NSPasteboard file URLs) — the same thing Finder's Cmd+C produces, so
  pasting into Claude Code, a chat app or a folder attaches the file rather
  than its text.

  pbcopy only does text, and AppleScript's `set the clipboard to POSIX file`
  handles one file at a time, so this drops to AppKit through JXA.

  Run: osascript -l JavaScript clip-files.jxa.js <list.json>
*/
ObjC.import('AppKit');

function run(argv) {
  const listFile = argv[0];
  if (!listFile) throw new Error('usage: clip-files.jxa.js <list.json>');

  const raw = $.NSString.stringWithContentsOfFileEncodingError(listFile, $.NSUTF8StringEncoding, null);
  if (!raw) throw new Error('cannot read ' + listFile);

  let paths = JSON.parse(ObjC.unwrap(raw));
  if (!Array.isArray(paths)) paths = [paths];

  const fm = $.NSFileManager.defaultManager;
  const urls = $.NSMutableArray.alloc.init;
  paths.forEach((p) => {
    if (fm.fileExistsAtPath($(p))) urls.addObject($.NSURL.fileURLWithPath($(p)));
  });
  if (urls.count === 0) throw new Error('none of the listed files exist');

  const pb = $.NSPasteboard.generalPasteboard;
  pb.clearContents;
  if (!pb.writeObjects(urls)) throw new Error('the pasteboard refused the write');

  return 'copied ' + urls.count + ' file(s)';
}
