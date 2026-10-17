const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
/** Text editing is ephemeral. Commands remain bound to this exact Session;
 * neither a default nor closing the panel substitutes a user confirmation. */
export class SourceCharacterNameView {
  constructor(root,onChange,{commands,owner}){this.root=root;this.onChange=onChange;this.commands=commands;this.owner=owner;this.token=null;this.key='';this.error='';this.edit='';this.stage=null;}
  render(session,disabled=false){
    const r=this.commands.characterNaming();if(session!==this.owner||!r){this.root.hidden=true;return;}
    if(r.token!==this.token){this.token=r.token;this.error='';this.key='';this.edit=r.draftName;this.stage=null;}
    if(r.stage==='input'&&this.stage!=='input')this.edit=r.draftName;this.stage=r.stage;
    const key=JSON.stringify([r.model,r.stage,r.draftName,disabled,this.error]);this.root.hidden=false;if(key===this.key)return;this.key=key;
    const token=r.token,current=()=>!disabled&&this.token===token&&this.commands.characterNaming()?.token===token;
    this.root.replaceChildren(node('h3','为角色命名'));
    const invoke=fn=>{if(!current())return;try{if(fn()){this.error='';this.key='';this.onChange();return;}this.error='当前请求已失效。';}
      catch(error){this.error=error instanceof Error?error.message:String(error);}this.key='';this.render(session,disabled);};
    if(r.stage==='input'){
      const form=node('form'),label=node('label','角色名字 '),input=node('input');input.type='text';input.value=this.edit;input.oninput=()=>{if(current())this.edit=input.value;};
      input.setAttribute('aria-label','角色名字');input.disabled=disabled;input.autocomplete='off';label.append(input);form.append(label);
      const button=node('button','确认名字');button.type='submit';button.disabled=disabled;form.append(button);
      form.onsubmit=e=>{e.preventDefault();invoke(()=>this.commands.submitCharacterName(token,input.value));};this.root.append(form);
    }else{
      this.root.append(node('p',`确定使用「${r.draftName}」吗？`));
      for(const [accepted,label]of [[true,'使用这个名字'],[false,'返回修改']]){const button=node('button',label);button.type='button';button.disabled=disabled;
        button.onclick=()=>invoke(()=>this.commands.confirmCharacterName(token,accepted));this.root.append(button);}
    }
    if(this.error)this.root.append(node('p',this.error));
  }
}
