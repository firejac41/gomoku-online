import RoomClient from "@/components/RoomClient";

export default async function OnlineRoomPage({ params }) {
  const { roomId } = await params;
  return <RoomClient roomId={roomId} />;
}
