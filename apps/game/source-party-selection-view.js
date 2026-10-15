const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);return n;};
/** Ephemeral editing only. The exact captured command gateway owns admission. */
export class SourcePartySelectionView {
  constructor(root,onChange,{commands,owner}) {
    this.root=root;this.onChange=onChange;this.commands=commands;this.owner=owner;this.reset();
  }
  reset(){this.token=null;this.draft=null;this.key='';this.error='';this.root.hidden=true;}
  render(session,disabled=false) {
    const request=this.commands.sourcePartySelection();
    if(session!==this.owner||!request){this.root.hidden=true;return;}
    const {token,model}=request;
    if(token!==this.token){this.token=token;this.draft=structuredClone(model.initial.slots);this.error='';this.key='';}
    const key=JSON.stringify([model,this.draft,disabled,this.error]);
    this.root.hidden=false;if(key===this.key)return;this.key=key;
    const names=new Map(session.state.snapshot().roster.map(member=>[member.id,member.name]));
    const current=()=>!disabled&&this.token===token&&this.commands.sourcePartySelection()?.token===token;
    this.root.replaceChildren(node('h3',`编成 ${model.slotCount} 支队伍`));
    this.root.append(node('p','选择成员后确认。取消会保留原成员，并返回第 1 队。'));
    for(let group=0;group<model.slotCount;group++) {
      const section=node('section');section.append(node('h4',`队伍 ${group+1}`));
      for(let position=0;position<4;position++) {
        const label=node('label',`位置 ${position+1} `),select=node('select');
        select.setAttribute('aria-label',`剧情编队 ${group+1} 位置 ${position+1}`);
        select.disabled=disabled||(group===0&&position<model.forced.length);
        const empty=node('option','空位');empty.value='';select.append(empty);
        for(const member of model.members) {
          const item=node('option',names.get(member.id)??member.id);item.value=member.id;
          item.disabled=this.draft.some((slot,g)=>slot.some((cell,p)=>cell.id===member.id&&(g!==group||p!==position)));
          select.append(item);
        }
        select.value=this.draft[group][position].id??'';
        select.onchange=()=>{if(!current())return;this.draft[group][position]={id:select.value||null,row:'front'};this.key='';this.render(session,disabled);};
        label.append(select);section.append(label);
      }
      this.root.append(section);
    }
    const finish=kind=>{
      if(!current())return;
      try {
        const outcome=kind==='confirm'?{kind,slots:structuredClone(this.draft)}:{kind};
        if(this.commands.completeSourcePartySelection(token,outcome)){this.reset();this.onChange();return;}
        this.error='当前请求已失效。';
      }catch(error){this.error=error instanceof Error?error.message:String(error);}
      this.key='';this.render(session,disabled);
    };
    for(const [kind,label] of [['confirm','确认编队'],['cancel','取消编队']]) {
      const button=node('button',label);button.type='button';button.disabled=disabled;
      button.onclick=()=>finish(kind);this.root.append(button);
    }
    if(this.error)this.root.append(node('p',this.error));
  }
}
