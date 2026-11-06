import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { avatarSrc, initials } from '@/lib/avatar'

// Siempre va junto al nombre: la imagen es decorativa (alt vacío) y las iniciales no se leen.
export function ProfileAvatar({ name, avatar, className }: { name: string | null | undefined; avatar?: string | null; className?: string }) {
  return (
    <Avatar className={className}>
      {avatar && <AvatarImage src={avatarSrc(avatar)} alt="" className="outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" />}
      <AvatarFallback aria-hidden="true">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}
