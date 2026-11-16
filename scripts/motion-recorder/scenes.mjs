// One scene per area of follow-up 08, section 9. Waits are in real-tempo milliseconds.
const cb = n => ({ name: `^Select Landscape study ${n}\\.png$` });
const tile = n => ({ name: `^Ready: Landscape study ${n}\\.png$` });
export const scenes = {
  // P1: buttons, tooltip, menu, dialog, toasts, theme
  p1_shared: { async run(a) {
    await a.wait(150);
    await a.move({ name: '^New project$' }); await a.wait(250);           // button hover
    await a.down(); await a.wait(150); await a.up(); await a.wait(500);     // press, release -> dialog opens
    await a.key('Escape', 'Escape', 27); await a.wait(400);                // dialog closes
    await a.move({ name: '^Toggle color theme$' }); await a.wait(700);     // tooltip after 400 ms
    await a.move({ name: '^Settings$' }); await a.wait(300);
    await a.click({ name: '^Image size$', css: '[role=combobox]' }); await a.wait(400); // menu opens
    await a.key('Escape', 'Escape', 27); await a.wait(300);                // menu closes
    await a.click(cb(24)); await a.wait(300);
    await a.click({ name: '^Move to trash$' }); await a.wait(900);        // toast in
    await a.click(cb(22)); await a.wait(200);
    await a.click({ name: '^Move to trash$' }); await a.wait(900);        // second toast replaces the first
    await a.move({ name: '^Dismiss|^Close notification|^Close$', css: '[role=status] button,[role=alert] button,[aria-live] button' }); await a.wait(200);
    await a.down(); await a.up(); await a.wait(400);                       // toast closed with the cross
    await a.click({ name: '^Toggle color theme$' }); await a.wait(300);    // theme switch: no transition
    await a.click({ name: '^Toggle color theme$' }); await a.wait(300);
  } },
  // P2: gallery and selection
  p2_gallery: { async run(a) {
    await a.wait(150);
    await a.move(tile(21)); await a.wait(300);                             // checkbox fades in on hover
    await a.click(cb(21)); await a.wait(400);                              // first selection: toolbar
    await a.click(cb(20)); await a.wait(300);                              // counter changes
    await a.click({ name: '^Archive$' }); await a.wait(800);               // tiles leave, neighbours move, toast
    await a.click({ name: '^Undo$' }); await a.wait(800);                  // tiles come back
    await a.click({ name: '^Masonry layout$' }); await a.wait(500);        // layout change
    await a.click({ name: '^Equal grid$' }); await a.wait(500);
    await a.click({ name: '^Justified rows$' }); await a.wait(500);
    await a.click({ name: '^In progress' }); await a.wait(450);            // filter to empty state
    await a.click({ name: '^Everything' }); await a.wait(450);
  } },
  // P3: image preview
  p3_preview: { async run(a) {
    await a.wait(150);
    await a.click(tile(22)); await a.wait(700);                            // opens from the tile
    await a.key('ArrowRight', 'ArrowRight', 39); await a.wait(400);        // next
    await a.key('ArrowRight', 'ArrowRight', 39); await a.wait(400);
    await a.key('ArrowLeft', 'ArrowLeft', 37); await a.wait(400);          // previous
    await a.click({ name: '^100%$' }); await a.wait(500);                  // zoom to 100%
    await a.click({ name: '^Fit$' }); await a.wait(500);
    await a.key('Escape', 'Escape', 27); await a.wait(700);                // returns into the tile
  } },
  // P4: sidebar, editor, queue
  p4_sidebar_editor: { async run(a) {
    await a.wait(150);
    await a.click({ name: '^Projects\\W*$', css: 'button' }); await a.wait(450); // section collapses
    await a.click({ name: '^Projects\\W*$', css: 'button' }); await a.wait(450); // expands
    await a.click({ name: '^Studio collection' }); await a.wait(400);      // active item moves
    await a.click({ name: '^All images' }); await a.wait(400);
    await a.click({ name: '^Generation source$', css: '[role=combobox]' }); await a.wait(300);
    await a.click({ name: '^Codex queue$', css: '[role=option]' }); await a.wait(400);
    await a.click({ name: '^Image prompt$' }); await a.type('A lighthouse at dawn'); await a.wait(400); // send button enables
    await a.click({ name: '^Queue image|^Generate image|^Add to queue|^Send', css: 'button' }); await a.wait(900); // new tile, Queue counter
    await a.click({ name: '^Minimize prompt editor$' }); await a.wait(450);
    await a.click({ name: '^New image$', index: 1 }); await a.wait(450);
  } },
  // P5: trash, empty state, settings
  p5_trash_settings: {
    async setup(a) { await a.click(cb(24)); await a.settle(300); await a.click({ name: '^Move to trash$' }); await a.settle(600); await a.click({ name: '^Trash' }); await a.settle(9000); },
    async run(a) {
      await a.wait(150);
      await a.move(tile(24)); await a.wait(250);
      await a.click(cb(24)); await a.wait(400);
      await a.move({ name: '^Restore' }); await a.wait(200);
      await a.down(); await a.up(); await a.wait(900);                     // tile leaves, empty state fades in
      await a.click({ name: '^Settings$' }); await a.wait(400);
    },
  },
};
scenes.dbg_archive = { async run(a) { await a.click({ name: '^Select Landscape study 21\\.png$' }); await a.wait(300); await a.click({ name: '^Select Landscape study 20\\.png$' }); await a.wait(300); await a.click({ name: '^Archive$' }); await a.wait(700); } };
// P1 tooltip: 400 ms delay, then fade; the next tooltip without delay
scenes.p1_tooltip = { async run(a) {
  await a.wait(150);
  await a.move({ name: '^Masonry layout$' }); await a.wait(800);
  await a.move({ name: '^Equal grid$' }); await a.wait(400);
  await a.moveTo(900, 180); await a.wait(400);
} };
