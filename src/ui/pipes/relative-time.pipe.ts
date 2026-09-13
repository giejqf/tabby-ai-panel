import { Pipe, PipeTransform } from '@angular/core'
import { relativeTime } from '../../core/util/text'

/** Impure so "just now" keeps ticking as the list stays open. */
@Pipe({ name: 'aiRelativeTime', pure: false })
export class RelativeTimePipe implements PipeTransform {
    transform (iso: string | null | undefined): string {
        return iso ? relativeTime(iso) : ''
    }
}
