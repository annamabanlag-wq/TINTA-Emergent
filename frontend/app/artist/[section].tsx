import { useCallback, useEffect, useState } from "react";
import { ScrollView, View, Text, Pressable, StyleSheet, TextInput } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSession } from "../../src/session";
import { api } from "../../src/api";
import { colors, spacing } from "../../src/theme";

const php = (n:number) => `₱${Number(n||0).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;

export default function ArtistSection(){
  const { section } = useLocalSearchParams<{section:string}>();
  const router = useRouter(); const { token } = useSession();
  const [data,setData]=useState<any>(null); const [busy,setBusy]=useState(false); const [date,setDate]=useState(""); const [error,setError]=useState("");
  const load=useCallback(async()=>{ if(!token)return; setError(""); try{
    if(section==="bookings") setData(await api<any[]>("/artist/bookings",{},token));
    else if(section==="earnings") setData(await api<any>("/artist/earnings",{},token));
    else if(section==="availability") setData(await api<any>("/artist/me",{},token));
    else if(section==="profile") setData((await api<any>("/artist/me",{},token)).artist);
    else setData([]);
  }catch(e:any){setError(e?.message||"Could not load.");}},[token,section]);
  useEffect(()=>{load()},[load]);
  const saveAvailability=async()=>{ if(!token||!data?.artist)return; setBusy(true); try{const blocked=[...(data.artist.blocked_dates||[])]; if(date && !blocked.includes(date)) blocked.push(date); await api("/artist/availability",{method:"PATCH",body:JSON.stringify({blocked_dates:blocked})},token); setData({...data,artist:{...data.artist,blocked_dates:blocked.sort()}});setDate("");}catch(e:any){setError(e?.message||"Could not save availability.")}finally{setBusy(false)}};
  const removeDate=async(d:string)=>{if(!token||!data?.artist)return;setBusy(true);try{const blocked=(data.artist.blocked_dates||[]).filter((x:string)=>x!==d);await api("/artist/availability",{method:"PATCH",body:JSON.stringify({blocked_dates:blocked})},token);setData({...data,artist:{...data.artist,blocked_dates:blocked}})}catch(e:any){setError(e?.message||"Could not update availability.")}finally{setBusy(false)}};
  const title=(section||"").replace(/^./,x=>x.toUpperCase());
  return <ScrollView style={styles.root} contentContainerStyle={styles.content}>
    <Pressable onPress={()=>router.replace("/artist/portal")}><Text style={styles.back}>← ARTIST PORTAL</Text></Pressable>
    <Text style={styles.kicker}>TINTA ARTIST</Text><Text style={styles.title}>{title.toUpperCase()}</Text>
    {error?<View style={styles.error}><Text style={styles.text}>{error}</Text></View>:null}
    {section==="bookings" && Array.isArray(data) ? <>{data.length?data.map((b:any)=><View style={styles.card} key={b.id}><View style={styles.row}><Text style={styles.cardTitle}>{b.date} · {b.time_slot}</Text><Text style={styles.badge}>{String(b.status).toUpperCase()}</Text></View><Text style={styles.name}>{b.customer_name}</Text><Text style={styles.text}>{b.description}</Text><Text style={styles.meta}>{b.estimated_hours} HR · PAYMENT {String(b.payment_status).toUpperCase()}</Text></View>):<Empty text="NO BOOKINGS YET"/></>}
    {section==="earnings" && data ? <><View style={styles.stat}><Text style={styles.small}>PENDING PAYOUT</Text><Text style={styles.big}>{php(data.pending_earnings)}</Text></View><View style={styles.stat}><Text style={styles.small}>PAID OUT</Text><Text style={styles.big}>{php(data.paid_out)}</Text></View><Text style={styles.section}>EARNINGS HISTORY</Text>{(data.entries||[]).map((r:any)=><View style={styles.card} key={r.id||r.booking_id}><Text style={styles.cardTitle}>{php(r.artist_earnings||r.amount)} · {String(r.status).replace("_"," ").toUpperCase()}</Text><Text style={styles.meta}>{r.created_at?new Date(r.created_at).toLocaleDateString():""}</Text></View>)}</> : null}
    {section==="availability" && data?.artist ? <><View style={styles.card}><Text style={styles.cardTitle}>BLOCK A DATE</Text><Text style={styles.text}>Enter a date in YYYY-MM-DD to mark yourself unavailable.</Text><TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={styles.input}/><Pressable disabled={busy} style={styles.cta} onPress={saveAvailability}><Text style={styles.ctaText}>{busy?"SAVING...":"BLOCK DATE"}</Text></Pressable></View><Text style={styles.section}>BLOCKED DATES</Text>{(data.artist.blocked_dates||[]).length?(data.artist.blocked_dates||[]).map((d:string)=><View style={styles.dateRow} key={d}><Text style={styles.cardTitle}>{d}</Text><Pressable onPress={()=>removeDate(d)}><Text style={styles.remove}>REMOVE</Text></Pressable></View>):<Empty text="NO BLOCKED DATES"/>}</> : null}
    {section==="profile" && data ? <View style={styles.card}><Text style={styles.cardTitle}>{data.name}</Text><Text style={styles.text}>@{data.handle}</Text><Text style={styles.text}>{data.city} · {data.studio}</Text><Text style={styles.text}>{php(data.rate_per_hour)}/HR</Text><Text style={styles.text}>★ {data.rating||0} · {data.reviews_count||0} REVIEWS</Text><Text style={styles.section}>BIO</Text><Text style={styles.text}>{data.bio}</Text></View> : null}
    {section==="messages" ? <Empty text="MESSAGING IS NEXT — CUSTOMER THREADS ARE ALREADY SUPPORTED BY TINTA."/> : null}
  </ScrollView>
}
function Empty({text}:{text:string}){return <View style={styles.empty}><Text style={styles.text}>{text}</Text></View>}
const styles=StyleSheet.create({root:{flex:1,backgroundColor:colors.surface},content:{padding:spacing.lg,gap:spacing.md,maxWidth:1000,width:"100%",alignSelf:"center",paddingBottom:60},back:{color:colors.brand,fontWeight:"900",letterSpacing:1.5},kicker:{color:colors.brand,fontSize:11,fontWeight:"900",letterSpacing:2,marginTop:10},title:{color:colors.onSurface,fontSize:34,fontWeight:"900",letterSpacing:2},card:{borderWidth:2,borderColor:colors.border,padding:18,gap:7},row:{flexDirection:"row",justifyContent:"space-between",gap:10},cardTitle:{color:colors.onSurface,fontWeight:"900",fontSize:15},name:{color:colors.onSurface,fontSize:19,fontWeight:"900"},text:{color:colors.muted,fontSize:13,lineHeight:20},meta:{color:colors.muted,fontSize:10,fontWeight:"800",letterSpacing:1},badge:{color:colors.brand,fontSize:9,fontWeight:"900"},stat:{borderWidth:2,borderColor:colors.borderStrong,padding:20},small:{color:colors.muted,fontSize:9,fontWeight:"900",letterSpacing:1.5},big:{color:colors.onSurface,fontSize:30,fontWeight:"900",marginTop:5},section:{color:colors.brand,fontSize:11,fontWeight:"900",letterSpacing:2,marginTop:spacing.md},input:{backgroundColor:colors.surfaceSecondary,borderWidth:2,borderColor:colors.border,color:colors.onSurface,padding:14,fontSize:15},cta:{backgroundColor:colors.brand,padding:16,alignItems:"center",marginTop:5},ctaText:{color:colors.onBrand,fontWeight:"900",letterSpacing:2},dateRow:{borderWidth:2,borderColor:colors.border,padding:16,flexDirection:"row",justifyContent:"space-between"},remove:{color:colors.brand,fontWeight:"900",fontSize:10,letterSpacing:1},empty:{borderWidth:2,borderColor:colors.border,padding:30,alignItems:"center"},error:{borderWidth:2,borderColor:colors.brand,padding:14}}
);