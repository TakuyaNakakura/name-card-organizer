import { deleteCardById } from "@/lib/db";
import { extractStorageKeyFromAssetUrl, getStorage } from "@/lib/storage";

export async function deleteCardAndAssets(cardId: string) {
  const deletedCard = await deleteCardById(cardId);
  if (!deletedCard) {
    return null;
  }

  const storage = getStorage();
  const assetKeys = Array.from(
    new Set(
      [deletedCard.originalImageUrl, deletedCard.correctedImageUrl]
        .map(extractStorageKeyFromAssetUrl)
        .filter((value): value is string => Boolean(value))
    )
  );

  await Promise.all(
    assetKeys.map(async (key) => {
      try {
        await storage.deleteObject(key);
      } catch (error) {
        console.error(`Failed to delete stored asset: ${key}`, error);
      }
    })
  );

  return deletedCard;
}
