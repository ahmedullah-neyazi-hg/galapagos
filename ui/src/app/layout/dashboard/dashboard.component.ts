import { Component, OnInit } from '@angular/core';
import { routerTransition } from '../../router.animations';
import {
    Change,
    ChangelogEntry,
    EnvironmentServerInfo,
    EnvironmentsService,
    KafkaEnvironment
} from '../../shared/services/environments.service';
import { Observable } from 'rxjs';
import { flatMap, map, mergeMap, shareReplay, startWith, take, tap } from 'rxjs/operators';
import { CustomLink, ServerInfo, ServerInfoService } from '../../shared/services/serverinfo.service';
import * as moment from 'moment';
import { TranslateService } from '@ngx-translate/core';
import { ApplicationInfo, ApplicationsService } from '../../shared/services/applications.service';
import { Location } from '@angular/common';

@Component({
    selector: 'app-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.scss'],
    animations: [routerTransition()]
})
export class DashboardComponent implements OnInit {

    allEnvironments: Observable<KafkaEnvironment[]>;

    selectedEnvironment: Observable<KafkaEnvironment>;

    serverInfos: Observable<EnvironmentServerInfo[]>;

    appServerInfo: Observable<ServerInfo>;

    customLinks: Observable<CustomLink[]>;

    kafkaVersion: Observable<string>;

    changelog: Observable<ChangelogEntry[]>;

    frameworkConfigTemplate: Observable<string>;

    configTemplatesCollapsed = true;

    configTemplatesCopiedValue = false;

    constructor(private environments: EnvironmentsService, private applicationsService: ApplicationsService,
                private serverInfoService: ServerInfoService, private location: Location,
                private translate: TranslateService) {
        this.allEnvironments = environments.getEnvironments();
        this.selectedEnvironment = environments.getCurrentEnvironment();
        this.serverInfos = environments.getCurrentEnvironmentServerInfo();
        this.changelog = this.selectedEnvironment.pipe(flatMap(env => environments.getChangeLog(env.id)))
            .pipe(map(changes => this.formatChanges(changes))).pipe(shareReplay(1));
    }

    ngOnInit() {
        this.appServerInfo = this.serverInfoService.getServerInfo();
        this.updateConfigTemplate('spring');
        this.customLinks = this.serverInfoService.getUiConfig().pipe(map(config => config.customLinks));
        this.kafkaVersion = this.selectedEnvironment.pipe(flatMap(env => this.serverInfoService.getKafkaVersion(env.id)));
    }

    selectEnvironment(envId: string) {
        this.allEnvironments.pipe(take(1)).toPromise().then(
            envs => this.environments.setCurrentEnvironment(envs.find(env => env.id === envId)));
    }

    updateConfigTemplate(framework: string) {
        this.frameworkConfigTemplate = this.selectedEnvironment
            .pipe(tap(env => this.configTemplatesCopiedValue = false))
            .pipe(flatMap(env => this.environments.getFrameworkConfigTemplate(env.id, framework)));
    }

    agoString(timestamp: string): string {
        return moment(timestamp).locale(this.translate.currentLang).fromNow();
    }

    agoTimeStamp(timestamp: string): string {
        return moment(timestamp).locale(this.translate.currentLang).format('L LT');
    }

    copyValueFromObservable(observer: Observable<string>) {
        const selBox = document.createElement('textarea');
        selBox.style.position = 'fixed';
        selBox.style.left = '0';
        selBox.style.top = '0';
        selBox.style.opacity = '0';
        const subscription = observer.subscribe(value => {
            selBox.value = value;
            document.body.appendChild(selBox);
            selBox.focus();
            selBox.select();
            document.execCommand('copy');
            document.body.removeChild(selBox);
            this.configTemplatesCopiedValue = true;
            subscription.unsubscribe();
        });
    }

    private formatChanges(changes: ChangelogEntry[]): ChangelogEntry[] {
        return changes
            .map(change => {
                change.change.html = this.changeHtml(change.change);
                return change;
            })
            .filter(change => change.change.html !== null).slice(0, 10);
    }

    private changeHtml(change: Change): Observable<string> {
        let topicName: string;
        let topicLink: string;

        switch (change.changeType) {
            case 'TOPIC_CREATED':
                if (change.topicMetadata.type === 'INTERNAL') {
                    return null;
                }
                topicName = change.topicMetadata.name;
                topicLink = this.urlForRouterLink('/topics/' + topicName);
                return this.translate.stream('CHANGELOG_TOPIC_CREATED_HTML', {
                    topicName: topicName,
                    topicLink: topicLink
                });
            case 'TOPIC_DELETED':
                if (change.internalTopic) {
                    return null;
                }
                topicName = change.topicName;
                return this.translate.stream('CHANGELOG_TOPIC_DELETED_HTML', { topicName: topicName });
            case 'TOPIC_DEPRECATED':
                topicLink = this.urlForRouterLink('/topics/' + topicName);
                topicName = change.topicName;
                const obsLang = this.translate.onLangChange.pipe(map(evt => evt.lang))
                    .pipe(startWith(this.translate.currentLang)).pipe(shareReplay(1));
                const obsEolDate = obsLang.pipe(map(lang => moment(change.eolDate).locale(lang).format('L')));
                return obsEolDate.pipe(map(date => this.translate.instant('CHANGELOG_TOPIC_DEPRECATED_HTML', {
                    topicName: topicName,
                    topicLink: topicLink,
                    date: date
                })));
            case 'TOPIC_UNDEPRECATED':
                topicLink = this.urlForRouterLink('/topics/' + topicName);
                topicName = change.topicName;
                return this.translate.stream('CHANGELOG_TOPIC_UNDEPRECATED_HTML', {
                    topicName: topicName,
                    topicLink: topicLink
                });
            case 'TOPIC_SCHEMA_VERSION_PUBLISHED':
                topicName = change.topicName;
                topicLink = this.urlForRouterLink('/topics/' + topicName);
                return this.translate.stream('CHANGELOG_TOPIC_SCHEMA_VERSION_REGISTERED_HTML',
                    { topicName: topicName, topicLink: topicLink });
            case 'TOPIC_DESCRIPTION_CHANGED':
                if (change.internalTopic) {
                    return null;
                }
                topicName = change.topicName;
                topicLink = this.urlForRouterLink('/topics/' + topicName);
                return this.translate.stream('CHANGELOG_TOPIC_DESCRIPTION_CHANGE_HTML', {
                    topicName: topicName,
                    topicLink: topicLink
                });
            case 'TOPIC_SUBSCRIBED':
                topicName = change.subscriptionMetadata.topicName;
                topicLink = this.urlForRouterLink('/topics/' + topicName);
                return this.applicationInfo(change.subscriptionMetadata.clientApplicationId).pipe(
                    flatMap(app => {
                        if (!app) {
                            return this.translate.stream('(unknown)').pipe(
                                flatMap(s => this.translate.stream('CHANGELOG_TOPIC_SUBSCRIBED_HTML_NO_APP_LINK',
                                    { topicName: topicName, topicLink: topicLink, appInfo: { name: s } })));
                        }
                        if (!app.infoUrl) {
                            return this.translate.stream('CHANGELOG_TOPIC_SUBSCRIBED_HTML_NO_APP_LINK',
                                { topicName: topicName, topicLink: topicLink, appInfo: app });
                        }

                        return this.translate.stream('CHANGELOG_TOPIC_SUBSCRIBED_HTML',
                            { topicName: topicName, topicLink: topicLink, appInfo: app });
                    }));
            case 'TOPIC_UNSUBSCRIBED':
                topicName = change.subscriptionMetadata.topicName;
                topicLink = this.urlForRouterLink('/topics/' + topicName);
                return this.applicationInfo(change.subscriptionMetadata.clientApplicationId).pipe(
                    flatMap(app => {
                        if (!app) {
                            return this.translate.stream('(unknown)').pipe(
                                flatMap(s => this.translate.stream('CHANGELOG_TOPIC_UNSUBSCRIBED_HTML_NO_APP_LINK',
                                    { topicName: topicName, topicLink: topicLink, appInfo: { name: s } })));
                        }
                        if (!app.infoUrl) {
                            return this.translate.stream('CHANGELOG_TOPIC_UNSUBSCRIBED_HTML_NO_APP_LINK',
                                { topicName: topicName, topicLink: topicLink, appInfo: app });
                        }
                        return this.translate.stream('CHANGELOG_TOPIC_UNSUBSCRIBED_HTML',
                            { topicName: topicName, topicLink: topicLink, appInfo: app });
                    }));
            case 'TOPIC_PRODUCER_APPLICATION_ADDED':
                topicName = change.topicName;
                topicLink = this.urlForRouterLink('/topics/' + topicName);
                const producerApplicationId = change.producerApplicationId;
                return this.applicationInfo(producerApplicationId).pipe(mergeMap(
                    producer => this.translate.stream('CHANGELOG_PRODUCER_ADDED_HTML', {
                        topicName: topicName,
                        topicLink: topicLink,
                        producerName: producer.name
                    })
                ));


        }
        return null;
    }

    private urlForRouterLink(routerLink: string): string {
        return this.location.prepareExternalUrl(routerLink);
    }

    private applicationInfo(applicationId: string): Observable<ApplicationInfo> {
        return this.applicationsService.getAvailableApplications(false).pipe(map(apps => apps.find(app => app.id === applicationId)));
    }
}
