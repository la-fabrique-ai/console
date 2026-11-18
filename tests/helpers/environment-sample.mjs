// A full environment of a project (M6), for the tests: one database, Drizzle migrations, two accounts. No server block:
// the server step is not part of v1 (decision 95).
export const sampleEnvironment=()=>({
  database:{engine:'postgres',port:5461,name:'beta',user:'postgres'},
  migrations:{tool:'drizzle',folder:'drizzle'},
  accounts:{table:'user',column:'email',keys:{po:'po@example.invalid',dev:'dev@example.invalid'}},
});
