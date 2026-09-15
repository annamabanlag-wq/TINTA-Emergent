import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../src/api";
import { useSession } from "../../src/session";
import { colors, spacing } from "../../src/theme";

type Contact={id:string;name:string;role:string;avatar?:string;conversation_id:string};
export default function MessagesTab(){
 const insets=useSafeAreaInsets();const router=useRouter();const{token}=useSession();const[contacts,setContacts]=useState<Contact[]>([]);const[loading,setLoading]=useState(true);const[refreshing,setRefreshing]=useState(false);
 const load=useCallback(async()=>{if(!token)return;try{setContacts(await api<Contact[]>("/chat/contacts",{},token))}catch{setContacts([])}finally{setLoading(false);setRefreshing(false)}},[token]);useEffect(()=>{load()},[load]);
 return <View style={s.root}><View style={[s.header,{paddingTop:insets.top+spacing.md}]}><Text style={s.title}>MESSAGES</Text></View>{loading?<View style={s.center}><ActivityIndicator color={colors.brand}/></View>:<FlatList data={contacts} keyExtractor={x=>x.conversation_id} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);load()}} tintColor={colors.brand}/>} renderItem={({item})=><Pressable onPress={()=>router.push(`/chat/conversation/${encodeURIComponent(item.conversation_id)}`)} style={s.row}>{item.avatar?<Image source={item.avatar} style={s.avatar} contentFit="cover"/>:<View style={s.botAvatar}><Text style={s.botText}>{item.role==="bot"?"AI":"T"}</Text></View>}<View style={s.body}><Text style={s.name}>{item.name.toUpperCase()}</Text><Text style={s.last}>{item.role==="bot"?"Chat with the TINTA AI assistant":"DIRECT MESSAGE · "+item.role.toUpperCase()}</Text></View><Text style={s.arrow}>›</Text></Pressable>}/>}</View>}
const s=StyleSheet.create({root:{flex:1,backgroundColor:colors.surface},header:{paddingHorizontal:spacing.lg,paddingBottom:spacing.md,borderBottomWidth:2,borderBottomColor:colors.borderStrong},title:{color:colors.onSurface,fontSize:36,fontWeight:"900",letterSpacing:2},center:{flex:1,alignItems:"center",justifyContent:"center"},row:{flexDirection:"row",alignItems:"center",gap:spacing.md,padding:spacing.lg,borderBottomWidth:1,borderBottomColor:colors.divider},avatar:{width:56,height:56,backgroundColor:colors.surfaceSecondary,borderWidth:2,borderColor:colors.borderStrong},botAvatar:{width:56,height:56,borderWidth:2,borderColor:colors.brand,alignItems:"center",justifyContent:"center",backgroundColor:colors.surfaceSecondary},botText:{color:colors.brand,fontSize:18,fontWeight:"900"},body:{flex:1,gap:4},name:{color:colors.onSurface,fontSize:15,fontWeight:"900",letterSpacing:1},last:{color:colors.muted,fontSize:12},arrow:{color:colors.brand,fontSize:28,fontWeight:"300"}});
