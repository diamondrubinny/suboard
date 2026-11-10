import { errorMessage } from '../api/client';
import { useToggleFavorite } from '../api/hooks';
import { useFeedback } from './Feedback';
import { Icon } from './Icon';

/** Star toggle for a board (personal favourites). State is conveyed by aria-pressed and the label, not colour. */
export function FavoriteButton({ boardId, boardName, favorite, className = 'icon-btn' }: { boardId: string; boardName: string; favorite: boolean; className?: string }) {
  const toggle = useToggleFavorite();
  const { toast } = useFeedback();
  return (
    <button
      type="button"
      className={`${className} fav-btn`}
      aria-pressed={favorite}
      aria-label={favorite ? `הסרת "${boardName}" מהמועדפים` : `הוספת "${boardName}" למועדפים`}
      title={favorite ? 'במועדפים' : 'הוספה למועדפים'}
      disabled={toggle.isPending}
      onClick={() =>
        toggle.mutate(
          { boardId, on: !favorite },
          { onSuccess: (r) => toast(r.favorite ? `"${boardName}" נוסף למועדפים` : `"${boardName}" הוסר מהמועדפים`), onError: (e) => toast(errorMessage(e), 'error') },
        )
      }
    >
      <Icon name="star" filled={favorite} />
    </button>
  );
}
