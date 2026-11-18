// Independent upper-bound model from Tracker's published complexity formula.
// No network/schema lookup in tests. Only the static subset used by our queries.
const connections=new Set(['projects','projectMilestones','documents','issues','labels','children','relations','inverseRelations','states','teams']);
// The enriched queries keep the default nested limit of 3. Legacy lists explicitly allow their existing 50 labels.
export function queryCost(query,{nestedLimits={}}={}){
  const tokens=query.match(/[A-Za-z_][\w]*|\d+|[{}():$!\[\],]/g);let i=0;
  while(tokens[i]!=='{')i++;
  function selection(){
    if(tokens[i++]!=='{')throw new Error('Missing selection');const fields=[];
    while(tokens[i]!=='}'){
      const name=tokens[i++];let first=50;
      if(tokens[i]==='('){
        let depth=1;i++;
        while(depth){
          if(tokens[i]==='first'&&tokens[i+1]===':')first=tokens[i+2]==='$'?50:Number(tokens[i+2]);
          if(tokens[i]==='(')depth++;if(tokens[i]===')')depth--;i++;
        }
      }
      fields.push({name,first,children:tokens[i]==='{'?selection():null});
    }
    i++;return fields;
  }
  const fields=selection();
  function cost(field){
    if(!field.children)return 0.1;
    if(connections.has(field.name))return 1+field.children.reduce((sum,child)=>sum+(child.name==='nodes'?field.first:1)*cost(child),0);
    return 1+field.children.reduce((sum,child)=>sum+cost(child),0);
  }
  function bounded(fields,nested=false){
    for(const field of fields){const connection=connections.has(field.name);if(connection&&field.first>(nested?(nestedLimits[field.name]??3):50))throw new Error('Unbounded nested connection');if(field.children)bounded(field.children,nested||connection);}
  }
  bounded(fields);return Math.ceil(fields.reduce((sum,field)=>sum+cost(field),0));
}
