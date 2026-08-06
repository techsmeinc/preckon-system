const hex2rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
const rgb2hex=c=>"#"+c.map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,"0")).join("").toUpperCase();
const lum=c=>{const s=c.map(v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;});return .2126*s[0]+.7152*s[1]+.0722*s[2];};
const R=(a,b)=>{const[x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05);};
function hsl(c){let[r,g,b]=c.map(v=>v/255);const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h=0,s=0;const l=(mx+mn)/2;
 if(mx!==mn){const d=mx-mn;s=l>.5?d/(2-mx-mn):d/(mx+mn);h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;h/=6;}return[h,s,l];}
function rgb([h,s,l]){if(!s)return[l*255,l*255,l*255];const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;
 const f=t=>{t=(t+1)%1;return t<1/6?p+(q-p)*6*t:t<1/2?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};return[f(h+1/3)*255,f(h)*255,f(h-1/3)*255];}
// Darken (or lighten, for dark grounds) until every listed ground clears `need`.
function ink(fg,bgs,need=4.5,dir=-1){
  const [h,s,l0]=hsl(hex2rgb(fg));
  for(let d=0;d<=1;d+=0.002){
    const l=l0+dir*d; if(l<0||l>1) continue;
    const c=hex2rgb(rgb2hex(rgb([h,s,l])));
    if(bgs.every(b=>R(c,hex2rgb(b))>=need)) return rgb2hex(c);
  }
  return null;
}
const show=(name,fg,bgs,need,dir)=>{
  const v=ink(fg,bgs,need,dir);
  console.log(`${name.padEnd(22)} ${fg} -> ${v}   ` + bgs.map(b=>R(hex2rgb(v),hex2rgb(b)).toFixed(2)).join(" / ") + `  on ${bgs.join(" ")}`);
};
console.log("TENANT (light grounds: surface, paper, panel-2, own tint)");
show("--teal-ink","#0FA593",["#FFFFFF","#F4F7FB","#F1F5F9","#E8FAF6"],4.5,-1);
show("--amber-ink","#F5A524",["#FFFFFF","#F4F7FB","#F1F5F9","#FEF3E2"],4.5,-1);
show("--blue-ink","#3B82F6",["#FFFFFF","#F4F7FB","#F1F5F9","#E7F0FE"],4.5,-1);
show("--red-ink","#EF4444",["#FFFFFF","#F4F7FB","#F1F5F9","#FDECEC"],4.5,-1);
show("--slate-400","#94A3B8",["#FFFFFF","#F4F7FB","#F1F5F9"],4.5,-1);
show("--slate-500","#64748B",["#FFFFFF","#F4F7FB","#F1F5F9"],5.9,-1);
console.log("\nHOST (dark grounds: surface, paper, panel-2, chip tints)");
show("--slate-400 dark","#6A7A8E",["#0F2033","#0A1626","#0C1B2E"],4.5,+1);
show("--teal-ink dark","#0FA593",["#0F2033","#0A1626","#103743"],4.5,+1);
show("--blue-ink dark","#3B82F6",["#0F2033","#0A1626","#163052"],4.5,+1);
show("--amber-ink dark","#F5A524",["#0F2033","#0A1626","#3A2B10"],4.5,+1);
show("--red-ink dark","#EF4444",["#0F2033","#0A1626","#3A1A1A"],4.5,+1);
console.log("\nink on the brand fill (buttons):");
for (const c of ["#FFFFFF","#06131D","#052620"]) console.log(`  ${c} on #15C2A8 = ${R(hex2rgb(c),hex2rgb("#15C2A8")).toFixed(2)}`);
