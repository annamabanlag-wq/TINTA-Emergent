import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl, TextInput, useWindowDimensions, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import Icon from "@react-native-vector-icons/feather";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../../src/api";
import { useSession } from "../../src/session";
import { colors, spacing } from "../../src/theme";

type Contact={id:string;name:string;role:string;avatar?:string;conversation_id:string};
type Msg={id:string;conversation_id:string;sender_id:string;sender_role:string;sender_name:string;text:string;created_at:string};
type Conversation={id:string;title:string;role:string;messages:Msg[]};

export default function MessagesTab(){
 const insets=useSafeAreaInsets();
 const router=useRouter();
 const {token,user}=useSession();
 const {width}=useWindowDimensions();
 const wide=width>=850;
 const [contacts,setContacts]=useState<Contact[]>([]);
 const [selected,setSelected]=useState<Contact|null>(null);
 const [conversation,setConversation]=useState<Conversation|null>(null);
 const [loading,setLoading]=useState(true);
 const [chatLoading,setChatLoading]=useState(false);
 const [refreshing,setRefreshing]=useState(false);
 const [search,setSearch]=useState("");
 const [text,setText]=useState("");
 const [sending,setSending]=useState(false);
 const list=useRef<FlatList<Msg>>(null);

 const loadContacts=useCallback(async()=>{
  if(!token)return;
  try{
   const data=await api<Contact[]>("/chat/contacts",{},token);
   setContacts(data);
   setSelected(current=>current&&data.some(x=>x.conversation_id===current.conversation_id)?current:(data[0]??null));
  }catch{setContacts([]);setSelected(null)}
  finally{setLoading(false);setRefreshing(false)}
 },[token]);

 const loadConversation=useCallback(async(contact:Contact)=>{
  if(!token)return;
  setChatLoading(true);
  try{
   const r=await api<Conversation>(`/chat/conversations/${encodeURIComponent(contact.conversation_id)}`,{},token);
   setConversation(r);
  }catch{setConversation({id:contact.conversation_id,title:contact.name,role:contact.role,messages:[]})}
  finally{setChatLoading(false)}
 },[token]);

 useEffect(()=>{loadContacts()},[loadContacts]);
 useEffect(()=>{if(wide&&selected)loadConversation(selected)},[wide,selected,loadConversation]);
 useEffect(()=>{
  if(!wide||!selected)return;
  const id=setInterval(()=>loadConversation(selected),4000);
  return()=>clearInterval(id);
 },[wide,selected,loadConversation]);

 const filtered=useMemo(()=>{
  const q=search.trim().toLowerCase();
  return q?contacts.filter(x=>x.name.toLowerCase().includes(q)||x.role.toLowerCase().includes(q)):contacts;
 },[contacts,search]);

 const choose=(item:Contact)=>{
  if(!wide){router.push(`/chat/conversation/${encodeURIComponent(item.conversation_id)}`);return;}
  setSelected(item);
 };

 const send=async()=>{
  const value=text.trim();
  if(!value||sending||!token||!selected)return;
  setText("");setSending(true);
  try{
   await api("/chat/send",{method:"POST",body:JSON.stringify({conversation_id:selected.conversation_id,text:value,bot:selected.conversation_id.startsWith("bot:")})},token);
   await loadConversation(selected);
   setTimeout(()=>list.current?.scrollToEnd({animated:true}),80);
  }catch{setText(value)}finally{setSending(false)}
 };

 const selectedTitle=conversation?.title||selected?.name||"TINTA AI";
 const selectedRole=conversation?.role||selected?.role||"bot";

 return <KeyboardAvoidingView style={s.root} behavior={Platform.OS==="ios"?"padding":undefined}>
  <View style={[s.header,{paddingTop:insets.top+spacing.md}]}>
   <Text style={s.title}>MESSAGES</Text>
  </View>
  {loading?<View style={s.center}><ActivityIndicator color={colors.brand}/></View>:<View style={[s.workspace,!wide&&s.mobileWorkspace]}>
   <View style={[s.sidebar,wide?s.sidebarWide:s.sidebarMobile]}>
    <View style={s.searchWrap}>
     <Icon name="search" size={21} color={colors.onSurface}/>
     <TextInput value={search} onChangeText={setSearch} placeholder="Search messages..." placeholderTextColor={colors.muted} style={s.searchInput}/>
    </View>
    <FlatList data={filtered} keyExtractor={x=>x.conversation_id} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);loadContacts()}} tintColor={colors.brand}/>} renderItem={({item})=><Pressable onPress={()=>choose(item)} style={[s.contact,wide&&selected?.conversation_id===item.conversation_id&&s.contactSelected]}>
      {item.avatar?<Image source={item.avatar} style={s.avatar} contentFit="cover"/>:<View style={[s.avatar,s.botAvatar]}><Text style={s.botText}>{item.role==="bot"?"AI":"T"}</Text></View>}
      <View style={s.contactBody}><Text style={s.name}>{item.name.toUpperCase()}</Text><Text numberOfLines={1} style={s.preview}>{item.role==="bot"?"Chat with the TINTA AI assistant":"DIRECT MESSAGE · "+item.role.toUpperCase()}</Text></View>
      <Text style={s.chevron}>›</Text>
    </Pressable>}/>
   </View>
   {wide&&<View style={s.chatPane}>
    {!selected?<View style={s.empty}><Text style={s.emptyTitle}>NO CONVERSATION</Text><Text style={s.emptySub}>Choose a contact to start.</Text></View>:<>
     <View style={s.chatHeader}><View style={[s.avatar,s.botAvatar]}><Text style={s.botText}>{selectedRole==="bot"?"AI":"T"}</Text></View><View style={{flex:1}}><Text style={s.chatTitle}>{selectedTitle.toUpperCase()}</Text><Text style={s.chatSub}>{selectedRole==="bot"?"TINTA AI ASSISTANT":"DIRECT MESSAGE"}</Text></View><Pressable style={s.more}><Icon name="more-vertical" size={22} color={colors.onSurface}/></Pressable></View>
     {chatLoading&&!conversation?<View style={s.center}><ActivityIndicator color={colors.brand}/></View>:<FlatList ref={list} data={conversation?.messages||[]} keyExtractor={m=>m.id} contentContainerStyle={s.messages} onContentSizeChange={()=>list.current?.scrollToEnd({animated:false})} renderItem={({item})=>{const mine=item.sender_id===user?.id;return <View style={[s.messageRow,mine?s.mine:s.theirs]}><View style={[s.bubble,mine?s.mineBubble:s.theirBubble]}>{!mine&&<Text style={s.sender}>{item.sender_name}</Text>}<Text style={[s.messageText,mine&&{color:colors.onBrand}]}>{item.text}</Text><Text style={[s.time,mine&&{color:colors.onBrand}]}>{new Date(item.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</Text></View></View>}} ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTitle}>{selectedRole==="bot"?"TALK TO TINTA AI":"START THE CONVERSATION"}</Text><Text style={s.emptySub}>{selectedRole==="bot"?"Ask about bookings, artists, GCash or TINTA.":"Send a message to continue."}</Text></View>}/>} />}
     <View style={[s.composer,{paddingBottom:insets.bottom+spacing.sm}]}><View style={s.inputWrap}><Icon name="paperclip" size={20} color={colors.muted}/><TextInput value={text} onChangeText={setText} placeholder="Type a message..." placeholderTextColor={colors.muted} style={s.input} multiline maxLength={1000}/></View><Pressable onPress={send} disabled={!text.trim()||sending} style={[s.send,(!text.trim()||sending)&&{opacity:.45}]}><Icon name="send" size={20} color={colors.onBrand}/></Pressable></View>
    </>}
   </View>}
  </View>}
 </KeyboardAvoidingView>;
}

const s=StyleSheet.create({
 root:{flex:1,backgroundColor:colors.surface},
 header:{paddingHorizontal:spacing.lg,paddingBottom:spacing.md,borderBottomWidth:2,borderBottomColor:colors.borderStrong},
 title:{color:colors.onSurface,fontSize:36,fontWeight:"900",letterSpacing:2},
 workspace:{flex:1,flexDirection:"row"},
 mobileWorkspace:{flexDirection:"column"},
 sidebar:{backgroundColor:colors.surface,borderRightWidth:1,borderRightColor:colors.border},
 sidebarWide:{width:390},
 sidebarMobile:{flex:1},
 searchWrap:{margin:spacing.md,height:52,borderWidth:2,borderColor:colors.border,backgroundColor:colors.surfaceSecondary,flexDirection:"row",alignItems:"center",gap:spacing.sm,paddingHorizontal:spacing.md},
 searchInput:{flex:1,color:colors.onSurface,fontSize:15},
 contact:{minHeight:82,flexDirection:"row",alignItems:"center",gap:spacing.md,paddingHorizontal:spacing.md,borderBottomWidth:1,borderBottomColor:colors.divider},
 contactSelected:{backgroundColor:colors.surfaceTertiary,borderLeftWidth:4,borderLeftColor:colors.brand},
 avatar:{width:52,height:52,backgroundColor:colors.surfaceSecondary,borderWidth:2,borderColor:colors.borderStrong,alignItems:"center",justifyContent:"center"},
 botAvatar:{borderColor:colors.brand},
 botText:{color:colors.brand,fontSize:17,fontWeight:"900"},
 contactBody:{flex:1,gap:4},
 name:{color:colors.onSurface,fontSize:14,fontWeight:"900",letterSpacing:1},
 preview:{color:colors.muted,fontSize:12},
 chevron:{color:colors.brand,fontSize:28},
 chatPane:{flex:1,borderLeftWidth:1,borderLeftColor:colors.border,backgroundColor:colors.surface},
 chatHeader:{minHeight:82,flexDirection:"row",alignItems:"center",gap:spacing.md,paddingHorizontal:spacing.lg,borderBottomWidth:1,borderBottomColor:colors.border},
 chatTitle:{color:colors.onSurface,fontSize:17,fontWeight:"900",letterSpacing:1.5},
 chatSub:{color:colors.brand,fontSize:10,fontWeight:"800",letterSpacing:1.5,marginTop:3},
 more:{padding:spacing.sm},
 messages:{padding:spacing.lg,gap:spacing.sm,flexGrow:1},
 messageRow:{flexDirection:"row"},
 mine:{justifyContent:"flex-end"},
 theirs:{justifyContent:"flex-start"},
 bubble:{maxWidth:"78%",paddingHorizontal:spacing.md,paddingVertical:spacing.sm,borderWidth:2},
 mineBubble:{backgroundColor:colors.brand,borderColor:colors.brand},
 theirBubble:{backgroundColor:colors.surfaceSecondary,borderColor:colors.border},
 sender:{color:colors.brand,fontSize:10,fontWeight:"900",letterSpacing:1,marginBottom:3},
 messageText:{color:colors.onSurface,fontSize:14,lineHeight:20},
 time:{color:colors.muted,fontSize:9,marginTop:4},
 composer:{flexDirection:"row",alignItems:"flex-end",gap:spacing.sm,padding:spacing.sm,borderTopWidth:2,borderTopColor:colors.borderStrong},
 inputWrap:{flex:1,minHeight:50,maxHeight:120,flexDirection:"row",alignItems:"center",gap:spacing.sm,paddingHorizontal:spacing.md,backgroundColor:colors.surfaceSecondary,borderWidth:2,borderColor:colors.border},
 input:{flex:1,color:colors.onSurface,fontSize:14,paddingVertical:spacing.sm},
 send:{width:50,height:50,backgroundColor:colors.brand,alignItems:"center",justifyContent:"center"},
 center:{flex:1,alignItems:"center",justifyContent:"center"},
 empty:{flex:1,alignItems:"center",justifyContent:"center",padding:spacing.xl},
 emptyTitle:{color:colors.onSurface,fontSize:20,fontWeight:"900",letterSpacing:2,textAlign:"center"},
 emptySub:{color:colors.muted,fontSize:11,fontWeight:"800",letterSpacing:1.5,marginTop:spacing.xs,textAlign:"center"},
});