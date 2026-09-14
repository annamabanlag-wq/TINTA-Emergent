import { Redirect } from "expo-router";

export default function ArtistSignIn() {
  return <Redirect href="/(auth)/sign-in?next=artist" />;
}
