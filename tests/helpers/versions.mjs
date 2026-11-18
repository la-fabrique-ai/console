// The version of a request as inbox-list gives it, for a test that answers as a screen does: what it shows.
export const versionOf=async(inbox,id)=>(await inbox.read(id)).version;
// Actions whose answers go as a screen sends them (inbox-answer), with the version of the request unless the test gives one.
export const asScreen=(actions,inbox)=>({...actions,decide:async input=>actions.click(input?.seen===undefined&&typeof input?.item==='string'?{...input,seen:await versionOf(inbox,input.item)}:input)});
