'use strict';
const PERMISSION_CHOICES=Object.freeze([
 {value:'workspace',label:'Ask for approval',description:'Ask before going beyond the selected folder or using restricted network access.'},
 {value:'auto_review',label:'Approve for me',description:'Codex reviews requests for additional access. Potentially unsafe actions may be blocked or need your input.'},
 {value:'full',label:'Full access',description:'Allow files, commands and internet access without Codex execution approval prompts.'},
]);
const validPermission=value=>PERMISSION_CHOICES.some(choice=>choice.value===value);
// New profiles default to Full access. Preserve saved choices; malformed values
// fall back to asking rather than silently expanding access.
const normalizePermission=value=>value==null?'full':validPermission(value)?value:'workspace';
function codexPermissions(value){
 const mode=normalizePermission(value);
 return {approvalPolicy:mode==='full'?'never':'on-request',sandbox:mode==='full'?'danger-full-access':'workspace-write',approvalsReviewer:mode==='auto_review'?'auto_review':'user'};
}
function permissionMenu(value,select){
 return {label:'Codex permissions',submenu:PERMISSION_CHOICES.map(choice=>({label:choice.label,type:'radio',checked:choice.value===normalizePermission(value),click:()=>select(choice.value)}))};
}
module.exports={PERMISSION_CHOICES,validPermission,normalizePermission,codexPermissions,permissionMenu};
