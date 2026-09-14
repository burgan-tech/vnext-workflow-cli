// Mirrors vNext InstanceDataVersionComparer: artifact first, package second;
// build metadata ignored, prereleases compared case-insensitively as in the runtime.
const canonical = v => v.split('+')[0].toLowerCase();
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
function parse(v) {
 if (typeof v !== 'string') throw new Error(`Invalid component version: ${v}`);
 const normalized=canonical(v);
 const [artifact,pkg,...extra]=normalized.split('-pkg.');
 if (extra.length || !/^\d+\.\d+\.\d+(?:-[a-z0-9]+(?:\.[a-z0-9]+)*)?$/.test(artifact) ||
     (pkg !== undefined && !/^\d+\.\d+\.\d+$/.test(pkg))) throw new Error(`Unsupported component version: ${v}`);
 return {canonical:normalized,artifact,package:pkg||null};
}
function semanticCompare(a,b) {
 if (!a || !b) return compare(!!a,!!b);
 const [ac,ap]=a.split('-'), [bc,bp]=b.split('-');
 const av=ac.split('.').map(BigInt),bv=bc.split('.').map(BigInt);
 for(let i=0;i<3;i++){const c=compare(av[i],bv[i]);if(c)return c;}
 if (!ap || !bp) return compare(!ap,!bp);
 return compare(ap,bp);
}
function versionCompare(a,b) {
 const av=parse(a.version),bv=parse(b.version);
 return semanticCompare(av.artifact,bv.artifact)||semanticCompare(av.package,bv.package);
}
function bestMatch(candidates,selector) {
 const requested=selector==null?'latest':String(selector).trim().toLowerCase();
 const sorted=[...candidates].sort(versionCompare).reverse();
 if (!requested || requested==='latest') return sorted[0];
 if (requested.includes('-pkg.')) {const full=parse(requested);return sorted.find(c=>parse(c.version).canonical===full.canonical);}
 const exact=sorted.find(c=>c.version.toLowerCase()===requested);
 if (exact) return exact;
 if (/^\d+(\.\d+)?$/.test(requested)) return sorted.find(c=>parse(c.version).artifact.startsWith(requested+'.'));
 const wanted=parse(requested).artifact;
 return sorted.find(c=>parse(c.version).artifact===wanted) || sorted.find(c=> {
   const pkg=parse(c.version).package;
   return pkg && semanticCompare(pkg,wanted)===0;
 });
}
module.exports={parse,versionCompare,bestMatch};
