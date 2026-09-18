'use strict';
// Menu tests look items up by label. The right-click menu is grouped into
// submenus, so they search a flattened copy: every item at every depth, parents
// before their children, in display order.
const flat=items=>(Array.isArray(items)?items:[]).flatMap(item=>[item,...flat(item?.submenu)]);
module.exports={flat};
