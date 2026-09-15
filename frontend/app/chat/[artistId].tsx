import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "../../src/api";
import { useSession } from "../../src/session";
import { colors } from "../../src/theme";

type Contact={id:string;name:string;role:string;conversation_id:string};
export default function ArtistChatRedirect(){const{artistId}=useLocalSearchParams<{artistId:string}>();const router=useRouter();const{token}=useSession();const[error,setError]=useState("");useEffect(()=>{let live=true;(async()=>{if(!token||!artistId)return;try{const contacts=await api<Contact[]>("/chat/contacts",{},token);const c=contacts.find(x=>x.role==="artist"&&x.id===artistId);if(c&&live)router.replace(`/chat/conversation/${encodeURIComponent(c.conversation_id)}`);else if(live)setError("This artist is not available for messaging right now.")}catch(e:any){if(live)setError(e?.message||"Could not open chat.")}})();return()=>{live=false}},[token,artistId,router]);return <View style={s.center}>{error?<Text style={s.error}>{error}</Text>:<><ActivityIndicator color={colors.brand}/><Text style={s.text}>OPENING CHAT...</Text></>}</View>}
const s=StyleSheet.create({center:{flex:1,backgroundColor:colors.surface,alignItems:"center",justifyContent:"center",gap:14,padding:24},text:{color:colors.muted,fontSize:11,fontWeight:"900",letterSpacing:1.5},error:{color:colors.onSurface,fontSize:15,textAlign:"center"}});
