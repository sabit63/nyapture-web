import { Snackbar } from '../../components/Snackbar'
import { AdvancedSearchDialog } from '../search/AdvancedSearchDialog'
import type { SearchController } from '../search/useSearchController'
import { LibraryDeleteDialog } from '../library/LibraryDeleteDialog'
import { ApiSettingsDialog } from '../settings/ApiSettingsDialog'
import type { ApiSettingsController } from '../settings/useApiSettings'

export type AppOverlaysProps = {
  searchController: SearchController
  apiSettingsController: ApiSettingsController
  notice: Parameters<typeof Snackbar>[0]['notice']
  onDismiss: Parameters<typeof Snackbar>[0]['onDismiss']
}

export function AppOverlays({
  searchController,
  apiSettingsController,
  notice,
  onDismiss,
}: AppOverlaysProps) {
  return (
    <>
      <AdvancedSearchDialog controller={searchController} />
      <ApiSettingsDialog controller={apiSettingsController} />
      <LibraryDeleteDialog
        dialogRef={searchController.deleteDialogRef}
        open={searchController.deleteDialogOpen}
        books={searchController.deleteDialogBooks}
        pending={searchController.deleteDialogPending}
        error={searchController.deleteDialogError}
        thumbnailRequest={searchController.deleteDialogThumbnailRequest}
        loadThumbnail={searchController.loadDeleteDialogThumbnail}
        onRequestClose={searchController.requestDeleteDialogClose}
        onAfterClose={searchController.afterDeleteDialogClose}
        resolveRestoreFocus={searchController.resolveDeleteRestoreFocus}
        onConfirm={searchController.confirmDeleteLibraryBooks}
      />
      <Snackbar notice={notice} onDismiss={onDismiss} />
    </>
  )
}
